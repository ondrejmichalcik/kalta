// ============================================================================
// Kalta – P2P sync data exchange
// Serializes local SQLite data into a JSON bundle for sending to another
// device via MultipeerConnectivity. Receives and merges incoming bundles
// using the same per-field merge + conflict-detection algorithm as the
// cloud sync engine (see src/lib/sync.ts).
//
// Strategy summary:
//  1. New row on remote, missing locally    → INSERT.
//  2. Local row, no pending local changes   → take remote wholesale if
//                                             its updated_at is newer.
//  3. Local row, has pending local changes  → per-field merge:
//      a. Compute diff (fields where local.value != remote.value).
//      b. overlap = diff ∩ local._changed_fields → real conflicts.
//      c. If overlap empty       → auto-merge remaining diff (other
//                                  device's edits to fields you didn't
//                                  touch are applied).
//      d. If overlap non-empty   → write a row to `_conflicts` so the
//                                  user resolves it via the existing
//                                  /conflicts screen, the same UI cloud
//                                  sync conflicts use.
//
// Soft-deletes ARE propagated via P2P — every row is exported including
// `_deleted_at` so the receiver can apply the same tombstone locally and
// stay in sync with the peer's view of what's been removed.
// ============================================================================
import { getDb } from './localDb';
import { recalcBoxCacheLocal } from './localWrites';
import { promoteCoupledConflicts } from './syncFieldGroups';

interface SyncBundle {
  version: 1;
  timestamp: string;
  senderId: string;
  warehouses: any[];
  warehouse_members: any[];
  boxes: any[];
  items: any[];
  custom_products: any[];
  inventory_sessions: any[];
  inventory_lines: any[];
}

// Per-table user-mutable fields. Must match the lists used by the cloud
// sync engine (sync.ts) — keeping them in sync ensures conflicts behave
// identically regardless of how data arrived.
const MERGE_FIELDS: Record<string, string[]> = {
  warehouses: ['name'],
  boxes: ['name', 'location'],
  items: [
    'name',
    'quantity',
    'unit',
    'expiry_date',
    'barcode',
    'image_url',
    'category',
    'notes',
    'opened',
    'damaged',
    'pack_count',
    'last_verified',
    'box_id',
    'energy_kcal_per_100g',
    'net_weight_g',
    'min_quantity',
  ],
  custom_products: ['name', 'category', 'image_url', 'typical_expiry_days'],
  inventory_sessions: ['notes', 'completed_at', 'missing_count', 'found_count'],
};

// Fields stored as 0/1 in SQLite but boolean in JS payloads. We normalize
// both sides before comparison to avoid spurious "string '1' != true" diffs.
const BOOL_FIELDS = new Set(['opened', 'damaged']);

// Only these tables carry the `_changed_fields` column in localDb. The
// other sync-tracked tables (custom_products, inventory_sessions, etc.)
// have no per-field history because they're either append-only or have
// no conflict-resolvable shape. SQL touching the column on those tables
// throws "no such column".
const TABLES_WITH_CHANGED_FIELDS = new Set(['warehouses', 'boxes', 'items']);
// Same story for `_local_updated_at` — only conflict-trackable tables
// carry it. inventory_lines is append-only and lacks even `_deleted_at`.
const TABLES_WITH_LOCAL_UPDATED = new Set(['warehouses', 'boxes', 'items']);

// ----------------------------------------------------------------------------
// Message envelope — wraps the raw bundle so we can multiplex other
// signalling messages (ACCEPT / REJECT) on the same MCSession channel.
// All P2P messages over the wire go through encodeMessage / decodeMessage.
// ----------------------------------------------------------------------------

/**
 * Resolution map for in-session conflict picks. Keys are
 * `${table}:${rowId}:${field}` — the value is whichever absolute value
 * the user chose. Both peers exchange their resolutions when accepting;
 * the import only proceeds when every entry matches across the two
 * peers (otherwise we surface a disagreement screen and let them retry).
 */
export type P2PResolutions = Record<string, unknown>;

export function resolutionKey(table: string, rowId: string, field: string): string {
  return `${table}:${rowId}:${field}`;
}

export type P2PMessage =
  | { type: 'BUNDLE'; bundle: string; senderName?: string }
  | { type: 'ACCEPT'; resolutions?: P2PResolutions }
  | { type: 'REJECT' }
  // Receipt confirmation. Peer echoes back as soon as it processes a
  // BUNDLE/ACCEPT/REJECT so the sender can prove the message arrived.
  | { type: 'ACK'; ackOf: 'BUNDLE' | 'ACCEPT' | 'REJECT' };

export function encodeMessage(msg: P2PMessage): string {
  return JSON.stringify(msg);
}

export function decodeMessage(raw: string): P2PMessage | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
      return parsed as P2PMessage;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Export all local data as a JSON sync bundle.
 */
export function exportSyncBundle(userId: string): string {
  const db = getDb();

  // Soft-deletes are included so peers see and apply the same tombstones.
  // The bundle is small enough (text-only, no blobs) that historic deletes
  // don't blow up payload size at the family scale Kalta is built for.
  const bundle: SyncBundle = {
    version: 1,
    timestamp: new Date().toISOString(),
    senderId: userId,
    warehouses: db.getAllSync('SELECT * FROM warehouses'),
    warehouse_members: db.getAllSync('SELECT * FROM warehouse_members'),
    boxes: db.getAllSync('SELECT * FROM boxes'),
    items: db.getAllSync('SELECT * FROM items'),
    custom_products: db.getAllSync('SELECT * FROM custom_products'),
    inventory_sessions: db.getAllSync('SELECT * FROM inventory_sessions'),
    inventory_lines: db.getAllSync('SELECT * FROM inventory_lines'),
  };

  return JSON.stringify(bundle);
}

// ----------------------------------------------------------------------------
// Preview — dry-run the bundle, returning what would change locally without
// touching SQLite. Used by the P2P review screen so each peer can inspect
// the proposed changes and explicitly accept (or reject) before anything
// is written.
// ----------------------------------------------------------------------------

export interface P2PPreviewEntry {
  table_name: string;
  row_id: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  /** Fields that would change for an UPDATE; null for INSERT. */
  changed_fields: string[] | null;
  /** Current local values for the changed fields (red side of the diff). */
  before_values: Record<string, any> | null;
  /** Peer's proposed values for the changed fields (green side). */
  after_values: Record<string, any> | null;
  /**
   * Subset of changed_fields that are real conflicts: I edited locally
   * AND the peer's value differs from my baseline (= true concurrent edit).
   * These will land in `_conflicts` if the user accepts the sync, exactly
   * like cloud sync conflicts.
   */
  conflict_fields: string[];
  display_name: string;
  context: string | null;
  category: string | null;
  nav: { href: string } | null;
}

/**
 * Compute, but do not apply, what `importSyncBundle(jsonString)` would do.
 * Returns one entry per resource that would change. Skips no-op rows.
 */
export function previewSyncBundle(jsonString: string): P2PPreviewEntry[] {
  const bundle: SyncBundle = JSON.parse(jsonString);
  if (bundle.version !== 1) throw new Error(`Unknown bundle version: ${bundle.version}`);

  const db = getDb();
  const out: P2PPreviewEntry[] = [];

  const tables: { table: string; rows: any[]; mergeFields: string[] }[] = [
    { table: 'warehouses', rows: bundle.warehouses, mergeFields: MERGE_FIELDS.warehouses },
    { table: 'boxes', rows: bundle.boxes, mergeFields: MERGE_FIELDS.boxes },
    { table: 'items', rows: bundle.items, mergeFields: MERGE_FIELDS.items },
    { table: 'custom_products', rows: bundle.custom_products, mergeFields: MERGE_FIELDS.custom_products },
    { table: 'inventory_sessions', rows: bundle.inventory_sessions, mergeFields: MERGE_FIELDS.inventory_sessions },
  ];

  for (const { table, rows, mergeFields } of tables) {
    for (const remote of rows) {
      const local = db.getFirstSync<any>(
        `SELECT * FROM ${table} WHERE id = ?`,
        [remote.id],
      );
      const remoteDeleted = remote._deleted_at != null;

      if (!local) {
        if (remoteDeleted) continue; // peer tombstoned a row we never had
        // Would be inserted as a brand-new resource.
        out.push(buildPreviewEntry(db, table, remote, null, null, [], 'INSERT'));
        continue;
      }

      // Peer is asking us to delete a row that's still alive locally.
      if (remoteDeleted) {
        if (local._deleted_at != null) continue; // already deleted, no-op
        out.push(buildPreviewEntry(db, table, remote, local, null, [], 'DELETE'));
        continue;
      }

      // Locally deleted, peer still has it alive — local delete wins,
      // nothing to preview (we won't resurrect).
      if (local._deleted_at != null) continue;

      // Existing row — figure out what would change.
      const diffFields = mergeFields.filter((f) =>
        !valuesEqualPreview(f, local[f], remote[f]),
      );
      if (diffFields.length === 0) continue;

      // Detect real conflicts: fields I edited where peer's value differs
      // from what I had as my baseline (matches cloud sync logic).
      const localChanged: string[] = local._changed_fields
        ? JSON.parse(local._changed_fields)
        : [];
      const baseline = getRowBaseline(db, table, remote.id);
      const conflictFields: string[] = [];
      if (local._synced === 0) {
        for (const f of localChanged) {
          if (!diffFields.includes(f)) continue;
          // Local already matches remote — no disagreement, skip.
          // Otherwise we'd surface a conflict for a field where both
          // peers independently arrived at the same value.
          if (valuesEqualPreview(f, local[f], remote[f])) continue;
          if (!baseline || !(f in baseline.values)) {
            conflictFields.push(f);
          } else if (!valuesEqualPreview(f, baseline.values[f], remote[f])) {
            conflictFields.push(f);
          }
        }
      }

      promoteCoupledConflicts(table, conflictFields, diffFields);

      out.push(buildPreviewEntry(db, table, remote, local, diffFields, conflictFields, 'UPDATE'));
    }
  }

  return out;
}

function buildPreviewEntry(
  db: ReturnType<typeof getDb>,
  table: string,
  remote: any,
  local: any | null,
  diffFields: string[] | null,
  conflictFields: string[],
  operation: 'INSERT' | 'UPDATE' | 'DELETE',
): P2PPreviewEntry {
  const changedFields = diffFields;
  const beforeValues =
    changedFields && local
      ? Object.fromEntries(changedFields.map((f) => [f, normalizeValue(f, local[f])]))
      : null;
  const afterValues = changedFields
    ? Object.fromEntries(changedFields.map((f) => [f, normalizeValue(f, remote[f])]))
    : null;
  // For items, always include `unit` in the values maps (even when unit
  // itself didn't change) so the review screen can render the quantity
  // with its unit context — picking "MINE 15" vs "THEIRS 3" alone is
  // meaningless when one side is pcs and the other is pack.
  // Doesn't affect `changed_fields`, so no extra diff row is rendered.
  if (table === 'items') {
    if (beforeValues && local && !('unit' in beforeValues)) {
      beforeValues.unit = local.unit ?? null;
    }
    if (afterValues && !('unit' in afterValues)) {
      afterValues.unit = remote.unit ?? null;
    }
  }
  const display = lookupPreviewDisplay(db, table, remote, local);
  return {
    table_name: table,
    row_id: remote.id,
    operation,
    changed_fields: changedFields,
    before_values: beforeValues,
    after_values: afterValues,
    conflict_fields: conflictFields,
    display_name: display.display_name,
    context: display.context,
    category: display.category,
    nav: display.nav,
  };
}

function normalizeValue(field: string, raw: any): any {
  if (BOOL_FIELDS.has(field)) return !!raw;
  return raw ?? null;
}


function valuesEqualPreview(field: string, a: any, b: any): boolean {
  if (BOOL_FIELDS.has(field)) return !!a === !!b;
  return String(a ?? '') === String(b ?? '');
}

// Mirrors lookupDisplayInfo from sync.ts but works against either the
// remote bundle row or the local row, and resolves human-readable
// references (box_id → "Box · Warehouse").
function lookupPreviewDisplay(
  db: ReturnType<typeof getDb>,
  table: string,
  remote: any,
  local: any | null,
): { display_name: string; context: string | null; category: string | null; nav: { href: string } | null } {
  const name: string = (local?.name ?? remote?.name ?? remote?.id?.slice(0, 8)) as string;

  if (table === 'items') {
    const boxId = remote.box_id ?? local?.box_id;
    let boxName: string | null = null;
    let warehouseId: string | null = null;
    let warehouseName: string | null = null;
    if (boxId) {
      const box = db.getFirstSync<{
        name: string;
        warehouse_id: string;
        warehouse_name: string | null;
      }>(
        `SELECT b.name, b.warehouse_id, w.name as warehouse_name
         FROM boxes b LEFT JOIN warehouses w ON b.warehouse_id = w.id
         WHERE b.id = ?`,
        [boxId],
      );
      boxName = box?.name ?? null;
      warehouseId = box?.warehouse_id ?? null;
      warehouseName = box?.warehouse_name ?? null;
    }
    const ctx = [boxName, warehouseName].filter(Boolean).join(' · ') || null;
    const nav =
      boxId && warehouseId
        ? { href: `/warehouse/${warehouseId}/box/${boxId}?itemId=${remote.id}` }
        : null;
    const category = (remote.category ?? local?.category) as string | null;
    return { display_name: name, context: ctx, category, nav };
  }

  if (table === 'boxes') {
    const warehouseId = remote.warehouse_id ?? local?.warehouse_id;
    let warehouseName: string | null = null;
    if (warehouseId) {
      const w = db.getFirstSync<{ name: string }>(
        `SELECT name FROM warehouses WHERE id = ?`,
        [warehouseId],
      );
      warehouseName = w?.name ?? null;
    }
    const nav = warehouseId
      ? { href: `/warehouse/${warehouseId}/box/${remote.id}` }
      : null;
    return { display_name: name, context: warehouseName, category: null, nav };
  }

  if (table === 'warehouses') {
    return {
      display_name: name,
      context: null,
      category: null,
      nav: { href: `/warehouse/${remote.id}` },
    };
  }

  return { display_name: name, context: null, category: null, nav: null };
}

/**
 * Import a sync bundle from another device and merge into local SQLite.
 * When `resolutions` is supplied, fields with a resolution entry skip the
 * usual conflict path and the resolution's value is applied directly —
 * this is how the P2P review-and-accept flow forces both peers onto the
 * same final value for every conflicted field.
 *
 * Returns stats about what changed and how many user-resolvable conflicts
 * were detected.
 */
export function importSyncBundle(
  jsonString: string,
  resolutions?: P2PResolutions,
): {
  inserted: number;
  updated: number;
  skipped: number;
  conflicts: number;
} {
  const bundle: SyncBundle = JSON.parse(jsonString);
  if (bundle.version !== 1) throw new Error(`Unknown sync bundle version: ${bundle.version}`);

  const db = getDb();
  const stats = { inserted: 0, updated: 0, skipped: 0, conflicts: 0 };
  const resolutionMap: P2PResolutions = resolutions ?? {};

  db.execSync('BEGIN TRANSACTION;');
  try {
    // Warehouses
    for (const row of bundle.warehouses) {
      mergeRowPerField(db, 'warehouses', row, MERGE_FIELDS.warehouses, stats, resolutionMap);
    }

    // Warehouse members (composite PK, no per-field history)
    for (const row of bundle.warehouse_members) {
      const local = db.getFirstSync(
        'SELECT * FROM warehouse_members WHERE warehouse_id = ? AND user_id = ?',
        [row.warehouse_id, row.user_id],
      ) as any;
      if (!local) {
        db.runSync(
          `INSERT INTO warehouse_members (warehouse_id, user_id, role, joined_at, _synced, _deleted_at)
           VALUES (?, ?, ?, ?, 1, NULL)`,
          [row.warehouse_id, row.user_id, row.role, row.joined_at],
        );
        stats.inserted++;
      } else {
        stats.skipped++;
      }
    }

    // Boxes
    for (const row of bundle.boxes) {
      mergeRowPerField(db, 'boxes', row, MERGE_FIELDS.boxes, stats, resolutionMap);
    }

    // Items — track which boxes were affected so we can recompute caches.
    const affectedBoxIds = new Set<string>();
    for (const row of bundle.items) {
      const before = stats.inserted + stats.updated + stats.conflicts;
      mergeRowPerField(db, 'items', row, MERGE_FIELDS.items, stats, resolutionMap);
      const after = stats.inserted + stats.updated + stats.conflicts;
      if (after > before) affectedBoxIds.add(row.box_id);
    }

    // Custom products
    for (const row of bundle.custom_products) {
      mergeRowPerField(db, 'custom_products', row, MERGE_FIELDS.custom_products, stats, resolutionMap);
    }

    // Inventory sessions
    for (const row of bundle.inventory_sessions) {
      mergeRowPerField(db, 'inventory_sessions', row, MERGE_FIELDS.inventory_sessions, stats, resolutionMap);
    }

    // Inventory lines (append-only, no merge — just insert if missing)
    for (const row of bundle.inventory_lines) {
      const local = db.getFirstSync(
        'SELECT id FROM inventory_lines WHERE id = ?',
        [row.id],
      ) as any;
      if (!local) {
        insertRow(db, 'inventory_lines', row);
        stats.inserted++;
      } else {
        stats.skipped++;
      }
    }

    // Recompute box caches for boxes whose items changed
    for (const boxId of affectedBoxIds) {
      recalcBoxCacheLocal(boxId);
    }

    db.execSync('COMMIT;');
  } catch (e) {
    db.execSync('ROLLBACK;');
    throw e;
  }

  return stats;
}

// ----------------------------------------------------------------------------
// Per-field merge — shared algorithm with cloud sync (see sync.ts).
// ----------------------------------------------------------------------------

function mergeRowPerField(
  db: any,
  table: string,
  remote: any,
  mergeFields: string[],
  stats: { inserted: number; updated: number; skipped: number; conflicts: number },
  resolutions: P2PResolutions = {},
): void {
  const local = db.getFirstSync(`SELECT * FROM ${table} WHERE id = ?`, [remote.id]) as any;
  const remoteDeleted = remote._deleted_at != null;

  // Case 1: row missing locally — insert it (unless the peer has it
  // tombstoned; importing a deleted row would just be churn).
  if (!local) {
    if (remoteDeleted) {
      stats.skipped++;
      return;
    }
    insertRow(db, table, remote);
    stats.inserted++;
    return;
  }

  // Case 1b: peer marked the row as deleted. Propagate the tombstone if
  // we don't already have one. Last-write-wins on delete: if both sides
  // have a delete, take the older timestamp so the row is consistently
  // marked as removed at its earliest known moment.
  if (remoteDeleted) {
    if (local._deleted_at != null) {
      // Both deleted — keep the earlier _deleted_at (cosmetic).
      if (remote._deleted_at < local._deleted_at) {
        db.runSync(
          `UPDATE ${table} SET _deleted_at = ? WHERE id = ?`,
          [remote._deleted_at, remote.id],
        );
      }
      stats.skipped++;
      return;
    }
    const localUpd = TABLES_WITH_LOCAL_UPDATED.has(table)
      ? ', _local_updated_at = NULL'
      : '';
    db.runSync(
      `UPDATE ${table} SET _deleted_at = ?, _synced = 1${localUpd} WHERE id = ?`,
      [remote._deleted_at, remote.id],
    );
    stats.updated++;
    return;
  }

  // Case 1c: locally deleted but peer still has it as alive. We don't
  // resurrect rows from a stale peer — local delete wins. The peer will
  // pick up our tombstone next time they import a bundle from us.
  if (local._deleted_at != null) {
    stats.skipped++;
    return;
  }

  // Case 2: row exists, locally fully synced (no pending edits).
  // Take the remote wholesale if its updated_at is newer; otherwise skip.
  if (local._synced !== 0) {
    const localTs = local.updated_at ?? local.created_at ?? '';
    const remoteTs = remote.updated_at ?? remote.created_at ?? '';
    if (remoteTs > localTs) {
      replaceRow(db, table, remote);
      stats.updated++;
    } else {
      stats.skipped++;
    }
    return;
  }

  // Case 3: row has pending local edits — baseline-aware per-field merge.
  // Uses the same conflict-detection algorithm as cloud sync (see sync.ts):
  //  - if remote.updated_at == baseline.updated_at, server hasn't moved
  //    since our edit started → no conflict possible
  //  - otherwise compare each locally-changed field against the baseline,
  //    not the local value, so we don't false-positive when our local
  //    update_at differs purely because of our own edit.
  const localChangedFields: string[] = local._changed_fields
    ? JSON.parse(local._changed_fields)
    : [];
  const baseline = getRowBaseline(db, table, remote.id);

  // Fast path: remote hasn't moved since our baseline.
  if (baseline?.updated_at && remote.updated_at === baseline.updated_at) {
    stats.skipped++;
    return;
  }

  // The peer's own pending-edit set, if their bundle row carries it.
  // Bundles SELECT * the row so this column comes through unchanged,
  // but rows where the peer is fully synced have it null/empty.
  let peerChangedFields: string[] | null = null;
  if (typeof remote._changed_fields === 'string' && remote._changed_fields.length > 0) {
    try {
      const parsed = JSON.parse(remote._changed_fields);
      if (Array.isArray(parsed)) peerChangedFields = parsed as string[];
    } catch { /* malformed — treat as null */ }
  }

  const realConflicts = localChangedFields.filter((f) => {
    // Local matches remote — both peers ended at the same value, so
    // there's no disagreement even if the baseline differs.
    if (valuesEqual(f, local[f], remote[f])) return false;
    if (!baseline || !(f in baseline.values)) {
      // No baseline captured (legacy entry) — fall back to value-only diff.
      return findDiffFields(local, remote, [f]).length > 0;
    }
    if (valuesEqual(f, baseline.values[f], remote[f])) {
      // Remote value matches my baseline — peer hasn't moved on this field.
      return false;
    }
    // Remote value differs from baseline. If we know the peer's pending
    // edits, only flag a conflict when the peer ACTIVELY edited this
    // field. Otherwise the difference comes from upstream propagation
    // (e.g., the cloud already received and replayed my own edit back to
    // the peer) and there's no real concurrent disagreement.
    if (peerChangedFields !== null && !peerChangedFields.includes(f)) {
      return false;
    }
    return true;
  });

  // Promote coupled-field conflicts (quantity + unit) so this side's
  // realConflicts mirrors the peer's: the resolution map keys must match
  // for the agreement check to pass.
  const allDiffFields = mergeFields.filter(
    (f) => findDiffFields(local, remote, [f]).length > 0,
  );
  promoteCoupledConflicts(table, realConflicts, allDiffFields);

  const autoMergeFields = mergeFields.filter((f) => {
    if (localChangedFields.includes(f)) return false;
    if (realConflicts.includes(f)) return false; // promoted into conflict
    return findDiffFields(local, remote, [f]).length > 0;
  });

  // If the caller supplied in-session resolutions for any of these
  // conflicts (P2P review-and-accept flow), apply the agreed value
  // directly and treat the field as resolved instead of stashing into
  // `_conflicts`. Anything without a resolution falls back to the
  // existing _conflicts behaviour so the user can still resolve it from
  // /conflicts later.
  const unresolvedConflicts: string[] = [];
  for (const f of realConflicts) {
    const key = resolutionKey(table, remote.id, f);
    if (key in resolutions) {
      const chosen = resolutions[key];
      const dbValue = BOOL_FIELDS.has(f) ? (chosen ? 1 : 0) : (chosen ?? null);
      db.runSync(`UPDATE ${table} SET ${f} = ? WHERE id = ?`, [dbValue, remote.id]);
      // Field is now in agreement with the peer — drop it from
      // _changed_fields so future syncs don't think it's still pending.
      removeFromChangedFields(db, table, remote.id, f);
    } else {
      unresolvedConflicts.push(f);
    }
  }

  if (unresolvedConflicts.length > 0) {
    // Real conflict — both sides modified at least one of the same fields
    // with different values, and no resolution was supplied. Store for
    // user resolution via the existing /conflicts UI.
    db.runSync(
      `INSERT INTO _conflicts (table_name, row_id, local_data, server_data, conflicting_fields)
       VALUES (?, ?, ?, ?, ?)`,
      [
        table,
        remote.id,
        JSON.stringify(local),
        JSON.stringify(remote),
        JSON.stringify(unresolvedConflicts),
      ],
    );
    stats.conflicts++;
    return;
  }

  // All conflicts (if any) were resolved in-session. If we also did
  // any auto-merge field updates we count those below; otherwise note
  // the row as updated for stats.
  if (realConflicts.length > 0 && autoMergeFields.length === 0) {
    stats.updated++;
    return;
  }

  if (autoMergeFields.length > 0) {
    // Auto-merge: apply remote's edits for fields the local user didn't
    // touch. Local edits stay intact.
    for (const f of autoMergeFields) {
      const val = BOOL_FIELDS.has(f) ? (remote[f] ? 1 : 0) : remote[f];
      db.runSync(`UPDATE ${table} SET ${f} = ? WHERE id = ?`, [val, remote.id]);
    }
    if (remote.updated_at) {
      db.runSync(
        `UPDATE ${table} SET updated_at = ? WHERE id = ?`,
        [remote.updated_at, remote.id],
      );
    }
    stats.updated++;
    return;
  }

  stats.skipped++;
}

// Drop a field from a row's `_changed_fields` JSON list. Used after an
// in-session conflict resolution agrees on a value: the field is no
// longer "pending" since both peers have committed to the same value.
function removeFromChangedFields(
  db: any,
  table: string,
  rowId: string,
  field: string,
): void {
  if (!TABLES_WITH_CHANGED_FIELDS.has(table)) return;
  const row = db.getFirstSync(
    `SELECT _changed_fields FROM ${table} WHERE id = ?`,
    [rowId],
  ) as { _changed_fields: string | null } | undefined;
  if (!row?._changed_fields) return;
  let list: string[] = [];
  try {
    list = JSON.parse(row._changed_fields);
    if (!Array.isArray(list)) return;
  } catch {
    return;
  }
  const next = list.filter((f) => f !== field);
  const json = next.length > 0 ? JSON.stringify(next) : null;
  db.runSync(
    `UPDATE ${table} SET _changed_fields = ? WHERE id = ?`,
    [json, rowId],
  );
}

// Compare values consistent with sync.ts; reused by mergeRowPerField.
function valuesEqual(field: string, a: any, b: any): boolean {
  if (BOOL_FIELDS.has(field)) return !!a === !!b;
  return String(a ?? '') === String(b ?? '');
}

// Reconstruct the row's baseline state from the unpushed queue entries.
// Mirrors the helper in sync.ts so P2P imports use the exact same conflict
// resolution semantics as cloud pulls.
function getRowBaseline(
  db: any,
  table: string,
  rowId: string,
): { updated_at: string | null; values: Record<string, any> } | null {
  const entries = db.getAllSync(
    `SELECT payload FROM _sync_queue
     WHERE table_name = ? AND row_id = ? AND operation = 'UPDATE' AND pushed_at IS NULL
     ORDER BY id ASC`,
    [table, rowId],
  ) as { payload: string | null }[];
  if (entries.length === 0) return null;

  const accumulated: Record<string, any> = {};
  for (const e of entries) {
    if (!e.payload) continue;
    try {
      const obj = JSON.parse(e.payload);
      const before = obj?.before;
      if (!before || typeof before !== 'object') continue;
      for (const [k, v] of Object.entries(before)) {
        if (!(k in accumulated)) accumulated[k] = v;
      }
    } catch {
      /* skip */
    }
  }
  const updatedAt = (accumulated.updated_at as string | undefined) ?? null;
  delete accumulated.updated_at;
  return { updated_at: updatedAt, values: accumulated };
}

function findDiffFields(local: any, remote: any, fields: string[]): string[] {
  return fields.filter((f) => {
    const l = BOOL_FIELDS.has(f) ? !!local[f] : local[f];
    const r = BOOL_FIELDS.has(f) ? !!remote[f] : remote[f];
    return String(l ?? '') !== String(r ?? '');
  });
}

// Strip metadata columns and convert booleans, then INSERT OR IGNORE.
function insertRow(db: any, table: string, row: any): void {
  const cols = Object.keys(row).filter((k) => !k.startsWith('_'));
  const allCols = [...cols, '_synced'];
  const placeholders = allCols.map(() => '?').join(', ');
  const values: any[] = cols.map((c) => {
    if (BOOL_FIELDS.has(c)) return row[c] ? 1 : 0;
    return row[c] ?? null;
  });
  values.push(1); // came from another device, treat as synced

  db.runSync(
    `INSERT OR IGNORE INTO ${table} (${allCols.join(', ')}) VALUES (${placeholders})`,
    values,
  );
}

// Replace the entire row contents (used in Case 2 — no local pending edits).
function replaceRow(db: any, table: string, row: any): void {
  const cols = Object.keys(row).filter((k) => !k.startsWith('_'));
  const updates = cols.map((c) => `${c} = ?`).join(', ');
  const values = cols.map((c) => {
    if (BOOL_FIELDS.has(c)) return row[c] ? 1 : 0;
    return row[c] ?? null;
  });
  values.push(row.id);

  // Only clear `_changed_fields` on tables that actually carry the
  // column — other sync-tracked tables (custom_products etc.) don't
  // have it and the SQL would error out with "no such column".
  const trailingSet = TABLES_WITH_CHANGED_FIELDS.has(table)
    ? ', _synced = 1, _changed_fields = NULL'
    : ', _synced = 1';
  db.runSync(
    `UPDATE ${table} SET ${updates}${trailingSet} WHERE id = ?`,
    values,
  );
}
