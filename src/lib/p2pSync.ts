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
// Deletes are intentionally NOT propagated via P2P — only `_deleted_at IS
// NULL` rows go in the bundle. Deletes flow through cloud sync.
// ============================================================================
import { getDb } from './localDb';
import { recalcBoxCacheLocal } from './localWrites';

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
  ],
  custom_products: ['name', 'category', 'image_url', 'typical_expiry_days'],
  inventory_sessions: ['notes', 'completed_at', 'missing_count', 'found_count'],
};

// Fields stored as 0/1 in SQLite but boolean in JS payloads. We normalize
// both sides before comparison to avoid spurious "string '1' != true" diffs.
const BOOL_FIELDS = new Set(['opened', 'damaged']);

/**
 * Export all local data as a JSON sync bundle.
 */
export function exportSyncBundle(userId: string): string {
  const db = getDb();

  const bundle: SyncBundle = {
    version: 1,
    timestamp: new Date().toISOString(),
    senderId: userId,
    warehouses: db.getAllSync('SELECT * FROM warehouses WHERE _deleted_at IS NULL'),
    warehouse_members: db.getAllSync('SELECT * FROM warehouse_members WHERE _deleted_at IS NULL'),
    boxes: db.getAllSync('SELECT * FROM boxes WHERE _deleted_at IS NULL'),
    items: db.getAllSync('SELECT * FROM items WHERE _deleted_at IS NULL'),
    custom_products: db.getAllSync('SELECT * FROM custom_products WHERE _deleted_at IS NULL'),
    inventory_sessions: db.getAllSync('SELECT * FROM inventory_sessions'),
    inventory_lines: db.getAllSync('SELECT * FROM inventory_lines'),
  };

  return JSON.stringify(bundle);
}

/**
 * Import a sync bundle from another device and merge into local SQLite.
 * Returns stats about what changed and how many user-resolvable conflicts
 * were detected.
 */
export function importSyncBundle(jsonString: string): {
  inserted: number;
  updated: number;
  skipped: number;
  conflicts: number;
} {
  const bundle: SyncBundle = JSON.parse(jsonString);
  if (bundle.version !== 1) throw new Error(`Unknown sync bundle version: ${bundle.version}`);

  const db = getDb();
  const stats = { inserted: 0, updated: 0, skipped: 0, conflicts: 0 };

  db.execSync('BEGIN TRANSACTION;');
  try {
    // Warehouses
    for (const row of bundle.warehouses) {
      mergeRowPerField(db, 'warehouses', row, MERGE_FIELDS.warehouses, stats);
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
      mergeRowPerField(db, 'boxes', row, MERGE_FIELDS.boxes, stats);
    }

    // Items — track which boxes were affected so we can recompute caches.
    const affectedBoxIds = new Set<string>();
    for (const row of bundle.items) {
      const before = stats.inserted + stats.updated + stats.conflicts;
      mergeRowPerField(db, 'items', row, MERGE_FIELDS.items, stats);
      const after = stats.inserted + stats.updated + stats.conflicts;
      if (after > before) affectedBoxIds.add(row.box_id);
    }

    // Custom products
    for (const row of bundle.custom_products) {
      mergeRowPerField(db, 'custom_products', row, MERGE_FIELDS.custom_products, stats);
    }

    // Inventory sessions
    for (const row of bundle.inventory_sessions) {
      mergeRowPerField(db, 'inventory_sessions', row, MERGE_FIELDS.inventory_sessions, stats);
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
): void {
  const local = db.getFirstSync(`SELECT * FROM ${table} WHERE id = ?`, [remote.id]) as any;

  // Case 1: row missing locally — insert it.
  if (!local) {
    insertRow(db, table, remote);
    stats.inserted++;
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

  const realConflicts = localChangedFields.filter((f) => {
    if (!baseline || !(f in baseline.values)) {
      // No baseline captured (legacy entry) — fall back to value-only diff.
      return findDiffFields(local, remote, [f]).length > 0;
    }
    return !valuesEqual(f, baseline.values[f], remote[f]);
  });

  const autoMergeFields = mergeFields.filter((f) => {
    if (localChangedFields.includes(f)) return false;
    return findDiffFields(local, remote, [f]).length > 0;
  });

  if (realConflicts.length > 0) {
    // Real conflict — both sides modified at least one of the same fields
    // with different values. Store for user resolution; reuse the cloud
    // _conflicts table so /conflicts UI handles both sources.
    db.runSync(
      `INSERT INTO _conflicts (table_name, row_id, local_data, server_data, conflicting_fields)
       VALUES (?, ?, ?, ?, ?)`,
      [
        table,
        remote.id,
        JSON.stringify(local),
        JSON.stringify(remote),
        JSON.stringify(realConflicts),
      ],
    );
    stats.conflicts++;
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

  db.runSync(
    `UPDATE ${table} SET ${updates}, _synced = 1, _changed_fields = NULL WHERE id = ?`,
    values,
  );
}
