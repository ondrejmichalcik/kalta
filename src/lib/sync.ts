// ============================================================================
// Kalta – Sync engine
// Handles bidirectional sync between local SQLite and Supabase.
//
// Pull: fetch server rows newer than last_pulled_at → upsert into SQLite.
// Push: read _sync_queue entries → apply to Supabase → mark pushed.
// Conflicts: per-field merge. If same field changed by both sides,
//            the conflict is flagged for user resolution.
// ============================================================================
import { getDb, initLocalDb } from './localDb';
import { supabase } from './supabase';
import { prefetchImages } from './imageCache';
import { markRecentLocalWrite } from './realtimeEcho';
import { promoteCoupledConflicts } from './syncFieldGroups';
// Lazy-required inside pushSync to break a circular import:
//   supabase.ts → sync.ts → subscription.ts → supabase.ts
// A static `import` here would resolve `subscription` mid-cycle and
// could leave subscription's own `supabase` binding pointing at an
// uninitialized supabase client, which had been deadlocking
// auth.getSession() on cold start.

// ---- Sync status tracking --------------------------------------------------

export type SyncStatus = 'idle' | 'syncing' | 'error';

type SyncStatusListener = (status: SyncStatus) => void;
const _statusListeners = new Set<SyncStatusListener>();
let _currentStatus: SyncStatus = 'idle';

export function getSyncStatus(): SyncStatus {
  return _currentStatus;
}

function setSyncStatus(s: SyncStatus) {
  _currentStatus = s;
  for (const fn of _statusListeners) fn(s);
}

export function subscribeSyncStatus(fn: SyncStatusListener): () => void {
  _statusListeners.add(fn);
  return () => { _statusListeners.delete(fn); };
}

// ---- Initial full sync (first launch or reset) ----------------------------

/**
 * Download ALL data from Supabase for warehouses the user is a member of
 * and populate local SQLite. Idempotent — uses INSERT OR REPLACE.
 * Called once on first login or when user forces a full re-sync.
 */
export async function initialFullSync(userId: string): Promise<void> {
  initLocalDb();
  const db = getDb();
  const now = new Date().toISOString();

  // 1. Fetch user's warehouse memberships
  const { data: memberships, error: memErr } = await supabase
    .from('warehouse_members')
    .select('*, warehouses(*)')
    .eq('user_id', userId);
  if (memErr) throw memErr;
  if (!memberships || memberships.length === 0) return;

  const warehouseIds = memberships.map((m: any) => m.warehouse_id);

  // 2. Fetch all related data in parallel.
  // allMembers covers every member of our warehouses, not just the caller —
  // otherwise the settings screen only shows the signed-in user.
  const [
    { data: users },
    { data: allMembers },
    { data: boxes },
    { data: items },
    { data: customProducts },
    { data: invitations },
    { data: householdMembers },
    { data: shoppingItems },
    { data: checklists },
    { data: checklistEntries },
    { data: checklistSatisfactions },
    { data: warehouseChecklists },
    { data: inventorySessions },
    { data: inventoryLines },
  ] = await Promise.all([
    supabase.from('users').select('*'),
    supabase.from('warehouse_members').select('*').in('warehouse_id', warehouseIds),
    supabase.from('boxes').select('*').in('warehouse_id', warehouseIds),
    supabase
      .from('items')
      .select('*, boxes!inner(warehouse_id)')
      .in('boxes.warehouse_id', warehouseIds),
    supabase.from('custom_products').select('*').in('warehouse_id', warehouseIds),
    supabase.from('invitations').select('*').in('warehouse_id', warehouseIds),
    supabase.from('household_members').select('*').in('warehouse_id', warehouseIds),
    supabase.from('shopping_list_items').select('*').in('warehouse_id', warehouseIds),
    supabase.from('checklists').select('*').in('warehouse_id', warehouseIds),
    supabase.from('checklist_entries').select('*').in('warehouse_id', warehouseIds),
    supabase.from('checklist_satisfactions').select('*').in('warehouse_id', warehouseIds),
    supabase.from('warehouse_checklists').select('*').in('warehouse_id', warehouseIds),
    supabase.from('inventory_sessions').select('*').in(
      'box_id',
      // Nested: sessions for boxes in our warehouses
      (await supabase.from('boxes').select('id').in('warehouse_id', warehouseIds)).data?.map(
        (b: any) => b.id,
      ) ?? [],
    ),
    // Lines will be fetched per session below
    Promise.resolve({ data: [] }),
  ]);

  // Start a transaction for atomic insert
  db.execSync('BEGIN TRANSACTION;');

  try {
    // Users
    for (const u of (users ?? []) as any[]) {
      db.runSync(
        `INSERT OR REPLACE INTO users (id, email, display_name, avatar_url, created_at, _synced)
         VALUES (?, ?, ?, ?, ?, 1)`,
        [u.id, u.email, u.display_name, u.avatar_url, u.created_at],
      );
    }

    // Warehouses (from memberships join)
    for (const m of memberships as any[]) {
      const w = m.warehouses;
      if (!w) continue;
      db.runSync(
        `INSERT OR REPLACE INTO warehouses (id, owner_id, name, created_at, readiness_goal_days, _synced, _local_updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
        [w.id, w.owner_id, w.name, w.created_at, w.readiness_goal_days ?? 14, now],
      );
    }

    // Warehouse members (ALL members of our warehouses, not just self)
    for (const m of (allMembers ?? []) as any[]) {
      db.runSync(
        `INSERT OR REPLACE INTO warehouse_members (warehouse_id, user_id, role, joined_at, _synced)
         VALUES (?, ?, ?, ?, 1)`,
        [m.warehouse_id, m.user_id, m.role, m.joined_at],
      );
    }

    // Boxes
    for (const b of (boxes ?? []) as any[]) {
      db.runSync(
        `INSERT OR REPLACE INTO boxes (id, warehouse_id, name, location, qr_code, nearest_expiry, item_count, created_at, updated_at, _synced, _local_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [b.id, b.warehouse_id, b.name, b.location, b.qr_code, b.nearest_expiry, b.item_count, b.created_at, b.updated_at, now],
      );
    }

    // Items (strip the joined boxes relation)
    for (const row of (items ?? []) as any[]) {
      const { boxes: _, ...i } = row;
      db.runSync(
        `INSERT OR REPLACE INTO items (id, box_id, name, quantity, unit, expiry_date, barcode, image_url, category, notes, opened, damaged, pack_count, last_verified, added_by, created_at, updated_at, energy_kcal_per_100g, net_weight_g, min_quantity, _synced, _local_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [i.id, i.box_id, i.name, i.quantity, i.unit, i.expiry_date, i.barcode, i.image_url, i.category, i.notes, i.opened ? 1 : 0, i.damaged ? 1 : 0, i.pack_count, i.last_verified, i.added_by, i.created_at, i.updated_at, i.energy_kcal_per_100g ?? null, i.net_weight_g ?? null, i.min_quantity ?? null, now],
      );
    }

    // Custom products
    for (const p of (customProducts ?? []) as any[]) {
      db.runSync(
        `INSERT OR REPLACE INTO custom_products (id, warehouse_id, barcode, name, category, image_url, typical_expiry_days, created_by, created_at, min_quantity, _synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [p.id, p.warehouse_id, p.barcode, p.name, p.category, p.image_url, p.typical_expiry_days, p.created_by, p.created_at, p.min_quantity ?? null],
      );
    }

    // Household members (Sprint 6)
    for (const m of (householdMembers ?? []) as any[]) {
      db.runSync(
        `INSERT OR REPLACE INTO household_members (id, warehouse_id, name, daily_kcal, daily_water_l, kind, created_at, _synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [m.id, m.warehouse_id, m.name, m.daily_kcal, m.daily_water_l, m.kind ?? null, m.created_at],
      );
    }

    // Shopping list items (Sprint 6)
    for (const s of (shoppingItems ?? []) as any[]) {
      db.runSync(
        `INSERT OR REPLACE INTO shopping_list_items (id, warehouse_id, label, category, source, source_ref, quantity, checked, created_at, _synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [s.id, s.warehouse_id, s.label, s.category, s.source, s.source_ref, s.quantity, s.checked ? 1 : 0, s.created_at],
      );
    }

    // Checklists (Sprint 7)
    for (const c of (checklists ?? []) as any[]) {
      db.runSync(
        `INSERT OR REPLACE INTO checklists (id, warehouse_id, name, is_seed, goal_days, created_at, updated_at, _synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [c.id, c.warehouse_id, c.name, c.is_seed ? 1 : 0, c.goal_days ?? null, c.created_at, c.updated_at],
      );
    }
    for (const e of (checklistEntries ?? []) as any[]) {
      db.runSync(
        `INSERT OR REPLACE INTO checklist_entries (id, checklist_id, warehouse_id, seed_key, label, group_name, category, keywords, quantified, rationale, sort_order, created_at, updated_at, _synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [e.id, e.checklist_id, e.warehouse_id, e.seed_key ?? null, e.label, e.group_name ?? null, e.category ?? null, e.keywords ?? null, e.quantified ?? null, e.rationale ?? null, e.sort_order ?? 0, e.created_at, e.updated_at],
      );
    }
    for (const s of (checklistSatisfactions ?? []) as any[]) {
      db.runSync(
        `INSERT OR REPLACE INTO checklist_satisfactions (id, checklist_entry_id, warehouse_id, item_id, mode, created_at, _synced)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [s.id, s.checklist_entry_id, s.warehouse_id, s.item_id ?? null, s.mode, s.created_at],
      );
    }
    for (const wc of (warehouseChecklists ?? []) as any[]) {
      db.runSync(
        `INSERT OR REPLACE INTO warehouse_checklists (id, warehouse_id, checklist_id, created_at, _synced)
         VALUES (?, ?, ?, ?, 1)`,
        [wc.id, wc.warehouse_id, wc.checklist_id, wc.created_at],
      );
    }

    // Invitations
    for (const inv of (invitations ?? []) as any[]) {
      db.runSync(
        `INSERT OR REPLACE INTO invitations (id, warehouse_id, invited_by, email, token, role, expires_at, accepted_at, created_at, _synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [inv.id, inv.warehouse_id, inv.invited_by, inv.email, inv.token, inv.role, inv.expires_at, inv.accepted_at, inv.created_at],
      );
    }

    // Inventory sessions
    for (const s of (inventorySessions ?? []) as any[]) {
      db.runSync(
        `INSERT OR REPLACE INTO inventory_sessions (id, box_id, performed_by, started_at, completed_at, found_count, missing_count, notes, created_at, _synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [s.id, s.box_id, s.performed_by, s.started_at, s.completed_at, s.found_count, s.missing_count, s.notes, s.created_at],
      );
    }

    // Update sync metadata
    const tables = ['users', 'warehouses', 'warehouse_members', 'boxes', 'items', 'custom_products', 'invitations', 'inventory_sessions', 'household_members', 'shopping_list_items', 'checklists', 'checklist_entries', 'checklist_satisfactions', 'warehouse_checklists'];
    for (const t of tables) {
      db.runSync(
        `INSERT OR REPLACE INTO _sync_meta (table_name, last_pulled_at) VALUES (?, ?)`,
        [t, now],
      );
    }

    db.execSync('COMMIT;');
  } catch (e) {
    db.execSync('ROLLBACK;');
    throw e;
  }
}

// ---- Incremental sync -----------------------------------------------------

/**
 * Check if initial sync has been performed.
 */
export function hasInitialSync(): boolean {
  const db = getDb();
  initLocalDb();
  const row = db.getFirstSync<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM _sync_meta WHERE last_pulled_at IS NOT NULL`,
  );
  return (row?.cnt ?? 0) > 0;
}

/**
 * Debounced auto-push. Every enqueueChange schedules a background push
 * so the queue drains without waiting for app restart or network reconnect.
 * Coalesces rapid writes (e.g. batch item inserts) into a single sync pass.
 */
let _pushTimer: ReturnType<typeof setTimeout> | null = null;
let _retryAttempt = 0;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 60000;
const RETRY_MAX_ATTEMPTS = 5;

function backoffDelay(): number {
  return Math.min(RETRY_BASE_MS * 2 ** (_retryAttempt - 1), RETRY_MAX_MS);
}

// Debounced auto-push with bounded exponential backoff. A normal write
// schedules a 500ms push; if that push leaves anything undelivered (network
// error → entry.failed), the next attempt backs off 2s → 4s → … capped at 60s,
// so a transient outage drains on its own instead of waiting for the next
// write or reconnect. A clean drain resets the backoff.
function scheduleAutoPush(delayMs = 500) {
  if (_pushTimer) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => {
    _pushTimer = null;
    const prev = _currentStatus;
    setSyncStatus('syncing');
    pushSync()
      .then((res) => {
        if (res.failed > 0) {
          // Something didn't drain — retry with backoff (bounded).
          if (_retryAttempt < RETRY_MAX_ATTEMPTS) _retryAttempt++;
          scheduleAutoPush(backoffDelay());
        } else {
          _retryAttempt = 0;
        }
      })
      .catch(() => {
        if (_retryAttempt < RETRY_MAX_ATTEMPTS) _retryAttempt++;
        scheduleAutoPush(backoffDelay());
      })
      .finally(() => {
        // Only drop back to idle if we were the one who set syncing.
        if (_currentStatus === 'syncing') setSyncStatus(prev === 'error' ? 'idle' : prev);
      });
  }, delayMs);
}

/**
 * Record a local mutation in the sync queue so it can be pushed to
 * Supabase on the next sync cycle. Auto-schedules a debounced push.
 */
export function enqueueChange(
  tableName: string,
  rowId: string,
  operation: 'INSERT' | 'UPDATE' | 'DELETE',
  changedFields?: string[],
  payload?: Record<string, any>,
): void {
  const db = getDb();
  db.runSync(
    `INSERT INTO _sync_queue (table_name, row_id, operation, changed_fields, payload)
     VALUES (?, ?, ?, ?, ?)`,
    [
      tableName,
      rowId,
      operation,
      changedFields ? JSON.stringify(changedFields) : null,
      payload ? JSON.stringify(payload) : null,
    ],
  );
  // Mark the row so the realtime subscription suppresses the server's
  // echo of our own write — we already updated SQLite optimistically.
  markRecentLocalWrite(tableName, rowId);
  scheduleAutoPush();
}

/**
 * Get count of pending (un-pushed) sync queue entries.
 */
export function getPendingSyncCount(): number {
  const db = getDb();
  const row = db.getFirstSync<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM _sync_queue WHERE pushed_at IS NULL`,
  );
  return row?.cnt ?? 0;
}

/**
 * Pending sync queue entry, denormalized with a human-readable name and
 * context (e.g. which box / warehouse the row belongs to). Used by the
 * pending changes screen so the user sees what specifically is waiting
 * to push, not just opaque row IDs.
 */
export interface PendingEntry {
  /**
   * Stable identifier for this aggregated entry — equal to the newest
   * underlying queue entry's id. Use `entry_ids` if you need every queue
   * row that this entry represents (e.g. for revert-all-on-this-resource).
   */
  id: number;
  /** All queue rows aggregated into this entry, newest-first. */
  entry_ids: number[];
  /** How many raw queue rows are aggregated. >= 1. */
  change_count: number;
  table_name: string;
  row_id: string;
  /**
   * Net operation across the aggregated entries:
   *  any INSERT  → INSERT
   *  else any DELETE → DELETE
   *  else            → UPDATE
   */
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  changed_fields: string[] | null;
  /**
   * Current values for the changed fields (for UPDATE ops). Read directly
   * from the row as it now stands — these represent the "after" state that
   * will get pushed to the server.
   */
  field_values: Record<string, any> | null;
  /**
   * Pre-update values for the changed fields, captured at enqueue time and
   * stored in the queue payload. Used to render "before → after" diffs on
   * the pending screen. Older entries (queued before this column was wired
   * in) and operations that didn't capture before-values may be null.
   */
  before_values: Record<string, any> | null;
  /** Timestamp of the OLDEST aggregated entry (when the resource first changed). */
  created_at: string;
  display_name: string;
  context: string | null;
  /**
   * Where to navigate when the user taps the resource name. `null` for
   * tables with no detail screen (custom_products, inventory_*).
   */
  nav: { href: string } | null;
  /** For items, the row's current category — drives the resource icon. */
  category: string | null;
}

// Whitelist of fields per table that the pending screen may read. Defends
// against a malformed _sync_queue.changed_fields injecting arbitrary SQL
// when interpolated into a SELECT.
const SAFE_FIELDS: Record<string, Set<string>> = {
  warehouses: new Set(['name']),
  boxes: new Set(['name', 'location']),
  items: new Set([
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
  ]),
  custom_products: new Set(['name', 'category', 'image_url', 'typical_expiry_days', 'min_quantity']),
  inventory_sessions: new Set(['notes', 'completed_at', 'found_count', 'missing_count']),
};

interface RawQueueRow {
  id: number;
  table_name: string;
  row_id: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  changed_fields: string | null;
  payload: string | null;
  created_at: string;
}

/**
 * Fetch all pending (un-pushed) sync queue entries grouped by resource
 * (table + row_id). Each returned PendingEntry represents the net pending
 * change to one resource, even if the user edited it multiple times since
 * the last sync. Groups are returned newest-activity first.
 */
export function getPendingEntries(): PendingEntry[] {
  const db = getDb();
  const rows = db.getAllSync<RawQueueRow>(
    `SELECT id, table_name, row_id, operation, changed_fields, payload, created_at
     FROM _sync_queue WHERE pushed_at IS NULL ORDER BY id ASC`,
  );

  // Group raw rows by resource (table + row_id), preserving chronological
  // order within each group (id ASC).
  const groups = new Map<string, RawQueueRow[]>();
  for (const r of rows) {
    const key = `${r.table_name}:${r.row_id}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  const aggregated: PendingEntry[] = [];
  for (const list of groups.values()) {
    aggregated.push(buildAggregatedEntry(db, list));
  }

  // Show most-recently touched resources first.
  aggregated.sort((a, b) => b.entry_ids[0] - a.entry_ids[0]);
  return aggregated;
}

function buildAggregatedEntry(
  db: ReturnType<typeof getDb>,
  rows: RawQueueRow[],
): PendingEntry {
  const newest = rows[rows.length - 1];
  const oldest = rows[0];
  const tableName = newest.table_name;
  const rowId = newest.row_id;

  // Net operation: INSERT trumps everything (means resource is new); else
  // a final DELETE wins; else UPDATE.
  const hasInsert = rows.some((r) => r.operation === 'INSERT');
  const hasDelete = rows.some((r) => r.operation === 'DELETE');
  const operation: PendingEntry['operation'] = hasInsert
    ? 'INSERT'
    : hasDelete
      ? 'DELETE'
      : 'UPDATE';

  // Union of changed_fields across all UPDATE rows.
  const changedFieldsSet = new Set<string>();
  for (const r of rows) {
    if (r.operation === 'UPDATE' && r.changed_fields) {
      try {
        for (const f of JSON.parse(r.changed_fields) as string[]) {
          changedFieldsSet.add(f);
        }
      } catch {
        /* malformed — skip */
      }
    }
  }
  const changedFields = changedFieldsSet.size > 0 ? Array.from(changedFieldsSet) : null;

  // Before snapshot: take the OLDEST UPDATE's `before` for each field.
  // That's the value from when the user first started modifying this row,
  // i.e., the true "previous" state.
  let beforeValues: Record<string, any> | null = null;
  if (operation === 'UPDATE' && changedFields) {
    const accumulated: Record<string, any> = {};
    for (const r of rows) {
      if (r.operation !== 'UPDATE' || !r.payload) continue;
      const partial = extractBeforeValues(r.payload, tableName);
      if (!partial) continue;
      for (const [k, v] of Object.entries(partial)) {
        // First write wins — earlier entries reflect older state.
        if (!(k in accumulated)) accumulated[k] = v;
      }
    }
    // For items, fold in the unit when quantity is in the accumulated
    // before snapshot so the pending screen can render "25 pcs". If
    // unit wasn't in any queue entry, it means the user didn't touch
    // unit — so the current row's unit is also the historical "before".
    if (
      tableName === 'items' &&
      'quantity' in accumulated &&
      !('unit' in accumulated)
    ) {
      const row = db.getFirstSync<{ unit: string | null }>(
        'SELECT unit FROM items WHERE id = ?',
        [rowId],
      );
      if (row) accumulated.unit = row.unit;
    }
    if (Object.keys(accumulated).length > 0) {
      beforeValues = resolveBeforeDisplayValues(db, accumulated);
    }
  }

  // After values: read current row state for the changed fields.
  const fieldValues =
    operation === 'UPDATE' && changedFields
      ? lookupFieldValues(db, tableName, rowId, changedFields)
      : null;

  const { display_name, context, nav, category } = lookupDisplayInfo(
    db,
    tableName,
    rowId,
    newest.payload,
  );

  return {
    id: newest.id,
    entry_ids: rows.map((r) => r.id).reverse(), // newest first
    change_count: rows.length,
    table_name: tableName,
    row_id: rowId,
    operation,
    changed_fields: changedFields,
    field_values: fieldValues,
    before_values: beforeValues,
    created_at: oldest.created_at,
    display_name,
    context,
    nav,
    category,
  };
}

// Parse the queue entry's payload and return its `before` map filtered to
// fields the pending screen is allowed to show. Anything else (e.g., bad
// JSON, unknown keys) is dropped silently.
function extractBeforeValues(
  payload: string,
  table: string,
): Record<string, any> | null {
  const allowed = SAFE_FIELDS[table];
  if (!allowed) return null;
  try {
    const obj = JSON.parse(payload);
    const before = obj?.before;
    if (!before || typeof before !== 'object') return null;
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(before)) {
      if (!allowed.has(k)) continue;
      if (k === 'opened' || k === 'damaged') out[k] = !!v;
      else out[k] = v ?? null;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

// Same as resolveDisplayValues above but called for the before-snapshot.
// We need a separate call because the before's box_id refers to where the
// item used to live, which may itself have been moved or deleted since.
// `resolveDisplayValues` queries the boxes table by id which still works
// for soft-deleted boxes (no _deleted_at filter).
function resolveBeforeDisplayValues(
  db: ReturnType<typeof getDb>,
  values: Record<string, any> | null,
): Record<string, any> | null {
  if (!values) return null;
  return resolveDisplayValues(db, values);
}

// Read current values of a row's changed fields, dropping anything not in
// the per-table whitelist. Boolean SQLite ints are normalized to true/false
// for display, and foreign-key UUIDs (currently just box_id) are resolved
// to "Name · Parent" strings so the user actually understands what changed.
function lookupFieldValues(
  db: ReturnType<typeof getDb>,
  table: string,
  rowId: string,
  fields: string[],
): Record<string, any> | null {
  const allowed = SAFE_FIELDS[table];
  if (!allowed) return null;
  const safeFields = fields.filter((f) => allowed.has(f));
  if (safeFields.length === 0) return null;
  // For items, fold in the unit field whenever quantity is being shown
  // so the pending screen can render "25 pcs" rather than a context-
  // less "25". Doesn't broaden changed_fields, so no extra diff row.
  const queryFields =
    table === 'items' && safeFields.includes('quantity') && !safeFields.includes('unit')
      ? [...safeFields, 'unit']
      : safeFields;

  try {
    const row = db.getFirstSync<Record<string, any>>(
      `SELECT ${queryFields.join(', ')} FROM ${table} WHERE id = ?`,
      [rowId],
    );
    if (!row) return null;
    const out: Record<string, any> = {};
    for (const f of queryFields) {
      const v = row[f];
      if (f === 'opened' || f === 'damaged') out[f] = !!v;
      else out[f] = v ?? null;
    }
    return resolveDisplayValues(db, out);
  } catch {
    return null;
  }
}

// Replace UUID-typed fields with human-readable labels for display.
// Currently only `box_id` is resolved — items can be moved between boxes
// and the user should see the box name, not its hex UUID.
function resolveDisplayValues(
  db: ReturnType<typeof getDb>,
  values: Record<string, any>,
): Record<string, any> {
  if (!('box_id' in values) || !values.box_id) return values;
  try {
    const box = db.getFirstSync<{ name: string; warehouse_name: string | null }>(
      `SELECT b.name, w.name as warehouse_name
       FROM boxes b LEFT JOIN warehouses w ON b.warehouse_id = w.id
       WHERE b.id = ?`,
      [values.box_id],
    );
    if (box) {
      const label = box.warehouse_name ? `${box.name} · ${box.warehouse_name}` : box.name;
      return { ...values, box_id: label };
    }
  } catch { /* best-effort */ }
  return values;
}

// Look up a row's user-facing name and any context (e.g., which box / warehouse
// it belongs to). The row itself may be soft-deleted (DELETE op) but is still
// in SQLite, so we can still query without filtering on `_deleted_at`. If even
// that fails — for example, the queue entry references a row hard-purged later —
// fall back to whatever the queue payload remembered, then to the bare ID.
function lookupDisplayInfo(
  db: ReturnType<typeof getDb>,
  table: string,
  rowId: string,
  payload: string | null,
): {
  display_name: string;
  context: string | null;
  nav: { href: string } | null;
  category: string | null;
} {
  const fallbackName = (() => {
    if (payload) {
      try {
        const p = JSON.parse(payload);
        if (p?.name) return p.name as string;
      } catch { /* malformed payload */ }
    }
    return rowId.slice(0, 8);
  })();

  try {
    if (table === 'items') {
      const row = db.getFirstSync<{
        name: string;
        category: string | null;
        box_id: string | null;
        box_name: string | null;
        warehouse_id: string | null;
        warehouse_name: string | null;
      }>(
        `SELECT i.name, i.category, i.box_id, b.name as box_name, b.warehouse_id, w.name as warehouse_name
         FROM items i
         LEFT JOIN boxes b ON i.box_id = b.id
         LEFT JOIN warehouses w ON b.warehouse_id = w.id
         WHERE i.id = ?`,
        [rowId],
      );
      if (row) {
        const ctx = [row.box_name, row.warehouse_name].filter(Boolean).join(' · ') || null;
        const nav =
          row.box_id && row.warehouse_id
            ? { href: `/warehouse/${row.warehouse_id}/box/${row.box_id}?itemId=${rowId}` }
            : null;
        return { display_name: row.name, context: ctx, nav, category: row.category };
      }
    } else if (table === 'boxes') {
      const row = db.getFirstSync<{ name: string; warehouse_id: string | null; warehouse_name: string | null }>(
        `SELECT b.name, b.warehouse_id, w.name as warehouse_name
         FROM boxes b LEFT JOIN warehouses w ON b.warehouse_id = w.id
         WHERE b.id = ?`,
        [rowId],
      );
      if (row) {
        const nav = row.warehouse_id
          ? { href: `/warehouse/${row.warehouse_id}/box/${rowId}` }
          : null;
        return { display_name: row.name, context: row.warehouse_name, nav, category: null };
      }
    } else if (table === 'warehouses') {
      const row = db.getFirstSync<{ name: string }>(
        `SELECT name FROM warehouses WHERE id = ?`,
        [rowId],
      );
      if (row) {
        return {
          display_name: row.name,
          context: null,
          nav: { href: `/warehouse/${rowId}` },
          category: null,
        };
      }
    } else if (table === 'custom_products') {
      const row = db.getFirstSync<{ name: string; warehouse_name: string | null }>(
        `SELECT cp.name, w.name as warehouse_name
         FROM custom_products cp LEFT JOIN warehouses w ON cp.warehouse_id = w.id
         WHERE cp.id = ?`,
        [rowId],
      );
      if (row) return { display_name: row.name, context: row.warehouse_name, nav: null, category: null };
    } else if (table === 'inventory_sessions') {
      const row = db.getFirstSync<{ box_name: string | null }>(
        `SELECT b.name as box_name
         FROM inventory_sessions s LEFT JOIN boxes b ON s.box_id = b.id
         WHERE s.id = ?`,
        [rowId],
      );
      if (row) return { display_name: 'Inventory session', context: row.box_name, nav: null, category: null };
    } else if (table === 'inventory_lines') {
      return { display_name: 'Inventory line', context: null, nav: null, category: null };
    }
  } catch { /* lookup failed, fall through to fallback */ }

  return { display_name: fallbackName, context: null, nav: null, category: null };
}

/**
 * Revert a single pending sync queue entry, rolling the local row back
 * to whatever state existed before the change was made.
 *
 *   INSERT  → delete the row (and any later queue entries that reference
 *              it; they'd be orphaned references anyway).
 *   UPDATE  → restore the `before` values captured in the queue payload
 *              and remove the corresponding fields from the row's
 *              _changed_fields list. If no _changed_fields remain the
 *              row is marked synced (_synced = 1).
 *   DELETE  → un-soft-delete the row.
 *
 * Throws if the entry has already been pushed (pushed_at IS NOT NULL),
 * or if it's an UPDATE without a captured before-snapshot in payload —
 * older entries created before before-tracking was added will fall in
 * this bucket; they can only be manually un-edited by the user.
 */
export function revertPendingEntry(
  entryId: number,
): { table: string; rowId: string; boxId: string | null } {
  const db = getDb();
  const entry = db.getFirstSync<{
    table_name: string;
    row_id: string;
    operation: 'INSERT' | 'UPDATE' | 'DELETE';
    changed_fields: string | null;
    payload: string | null;
    pushed_at: string | null;
  }>('SELECT * FROM _sync_queue WHERE id = ?', [entryId]);

  if (!entry) throw new Error('Change not found.');
  if (entry.pushed_at) {
    throw new Error('This change has already been synced and cannot be reverted.');
  }

  // Capture box_id BEFORE the revert so the caller can recompute box caches
  // even when the row is about to be deleted (INSERT revert).
  let boxId: string | null = null;
  if (entry.table_name === 'items') {
    boxId =
      db.getFirstSync<{ box_id: string }>(
        'SELECT box_id FROM items WHERE id = ?',
        [entry.row_id],
      )?.box_id ?? null;
  } else if (entry.table_name === 'boxes' && entry.operation === 'INSERT') {
    boxId = entry.row_id;
  }

  db.execSync('BEGIN TRANSACTION;');
  try {
    if (entry.operation === 'INSERT') {
      // Hard-delete the row. Any later queue entries for the same row are
      // also dropped — they'd reference a row that no longer exists.
      db.runSync(`DELETE FROM ${entry.table_name} WHERE id = ?`, [entry.row_id]);
      db.runSync(
        `DELETE FROM _sync_queue WHERE table_name = ? AND row_id = ?`,
        [entry.table_name, entry.row_id],
      );
    } else if (entry.operation === 'DELETE') {
      // Restore the soft-deleted row.
      db.runSync(
        `UPDATE ${entry.table_name}
           SET _deleted_at = NULL, _synced = 1, _local_updated_at = NULL
         WHERE id = ?`,
        [entry.row_id],
      );
      db.runSync('DELETE FROM _sync_queue WHERE id = ?', [entryId]);
    } else {
      // UPDATE — apply before values back.
      const allowed = SAFE_FIELDS[entry.table_name];
      if (!allowed) throw new Error(`Cannot revert changes to ${entry.table_name}.`);
      const changedFields: string[] = entry.changed_fields
        ? JSON.parse(entry.changed_fields)
        : [];
      const payload = entry.payload ? JSON.parse(entry.payload) : null;
      const before = payload?.before;
      if (!before || typeof before !== 'object' || Object.keys(before).length === 0) {
        throw new Error(
          'Cannot revert: no before snapshot was captured for this change.',
        );
      }

      const restoreFields = changedFields.filter(
        (f) => allowed.has(f) && f in before,
      );
      if (restoreFields.length === 0) {
        throw new Error('Nothing to revert in this change.');
      }

      const setExprs = restoreFields.map((f) => `${f} = ?`);
      const setValues = restoreFields.map((f) => {
        const v = before[f];
        if (f === 'opened' || f === 'damaged') return v ? 1 : 0;
        return v ?? null;
      });

      // Update _changed_fields: remove the fields we just reverted. If
      // nothing's left, the row is back in sync with the server.
      const rowMeta = db.getFirstSync<{ _changed_fields: string | null }>(
        `SELECT _changed_fields FROM ${entry.table_name} WHERE id = ?`,
        [entry.row_id],
      );
      const currentChanged: string[] = rowMeta?._changed_fields
        ? JSON.parse(rowMeta._changed_fields)
        : [];
      const remaining = currentChanged.filter((f) => !restoreFields.includes(f));
      const remainingJson = remaining.length > 0 ? JSON.stringify(remaining) : null;
      const fullySynced = remaining.length === 0;

      db.runSync(
        `UPDATE ${entry.table_name}
           SET ${setExprs.join(', ')},
               _changed_fields = ?,
               _synced = ?,
               _local_updated_at = ?
         WHERE id = ?`,
        [
          ...setValues,
          remainingJson,
          fullySynced ? 1 : 0,
          new Date().toISOString(),
          entry.row_id,
        ],
      );
      db.runSync('DELETE FROM _sync_queue WHERE id = ?', [entryId]);
    }
    db.execSync('COMMIT;');
  } catch (e) {
    db.execSync('ROLLBACK;');
    throw e;
  }

  return { table: entry.table_name, rowId: entry.row_id, boxId };
}

/**
 * Revert every pending change in one shot. Iterates the queue
 * newest-first so an UPDATE chain on the same row unwinds in reverse
 * order — each revert sees a still-consistent before-snapshot.
 *
 * Entries that can't be reverted (e.g., legacy entries from before
 * before-snapshots were captured) are skipped and counted in the result.
 *
 * Returns the affected box IDs so the caller can recompute their caches.
 */
export function revertAllPendingEntries(): {
  reverted: number;
  skipped: number;
  affectedBoxIds: string[];
} {
  const db = getDb();
  const ids = db.getAllSync<{ id: number }>(
    `SELECT id FROM _sync_queue WHERE pushed_at IS NULL ORDER BY id DESC`,
  );

  let reverted = 0;
  let skipped = 0;
  const affected = new Set<string>();

  for (const { id } of ids) {
    try {
      const result = revertPendingEntry(id);
      reverted++;
      if (result.boxId) affected.add(result.boxId);
    } catch {
      skipped++;
    }
  }

  return { reverted, skipped, affectedBoxIds: Array.from(affected) };
}

/**
 * Get count of unresolved sync conflicts.
 */
export function getConflictCount(): number {
  const db = getDb();
  const row = db.getFirstSync<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM _conflicts WHERE resolved_at IS NULL`,
  );
  return row?.cnt ?? 0;
}

// ---- Push sync: local → Supabase ------------------------------------------

const PUSHABLE_TABLES = ['warehouses', 'boxes', 'items', 'custom_products', 'inventory_sessions', 'inventory_lines', 'household_members', 'shopping_list_items'] as const;

/**
 * Compare local and server row to find which fields differ.
 * Only checks the specified fields (ignores metadata columns).
 */
function findDiffFields(local: any, server: any, fields: string[]): string[] {
  return fields.filter((f) => {
    const l = (f === 'opened' || f === 'damaged') ? !!local[f] : local[f];
    const s = (f === 'opened' || f === 'damaged') ? !!server[f] : server[f];
    return String(l ?? '') !== String(s ?? '');
  });
}

// Compare two values for a given field, with the same boolean / null
// normalisation we use everywhere else. Used by the conflict-detection
// path to compare baseline values against server values.
function valuesEqual(field: string, a: any, b: any): boolean {
  if (field === 'opened' || field === 'damaged') return !!a === !!b;
  return String(a ?? '') === String(b ?? '');
}

/**
 * Reconstruct the row's "baseline" — its state on the server the last
 * time the local user was in sync. We aggregate across every unpushed
 * UPDATE queue entry for the row, oldest first; for each field, the
 * earliest captured before-value wins (i.e. true pre-edit state). The
 * baseline timestamp comes from the oldest entry's payload.before.updated_at,
 * which captureBefore stamped at the moment of the user's first edit.
 *
 * Used by pullSync to resolve conflicts:
 *  - server.updated_at == baseline.updated_at  → no concurrent server edit,
 *                                                 our local edits are the only
 *                                                 changes; nothing to do here,
 *                                                 the next push will deliver
 *                                                 them.
 *  - server.value[f] == baseline.value[f]      → server didn't touch f even
 *                                                 though something on the row
 *                                                 changed; my local edit to f
 *                                                 is unaffected.
 *  - server.value[f] != baseline.value[f] AND
 *    f in localChanges                          → real conflict.
 */
function getRowBaseline(
  db: ReturnType<typeof getDb>,
  table: string,
  rowId: string,
): { updated_at: string | null; values: Record<string, any> } | null {
  const entries = db.getAllSync<{ payload: string | null }>(
    `SELECT payload FROM _sync_queue
     WHERE table_name = ? AND row_id = ? AND operation = 'UPDATE' AND pushed_at IS NULL
     ORDER BY id ASC`,
    [table, rowId],
  );
  if (entries.length === 0) return null;

  const accumulated: Record<string, any> = {};
  for (const e of entries) {
    if (!e.payload) continue;
    try {
      const obj = JSON.parse(e.payload);
      const before = obj?.before;
      if (!before || typeof before !== 'object') continue;
      // First write wins per field — earlier entries reflect older state.
      for (const [k, v] of Object.entries(before)) {
        if (!(k in accumulated)) accumulated[k] = v;
      }
    } catch {
      /* skip malformed payload */
    }
  }

  const updatedAt = (accumulated.updated_at as string | undefined) ?? null;
  delete accumulated.updated_at;
  return { updated_at: updatedAt, values: accumulated };
}

// ---- Conflict resolution --------------------------------------------------

export interface SyncConflict {
  id: number;
  table_name: string;
  row_id: string;
  local_data: Record<string, any>;
  server_data: Record<string, any>;
  conflicting_fields: string[];
  created_at: string;
}

/**
 * Get all unresolved conflicts. Filters out fields that no longer
 * actually disagree (local value == server value) — those can be
 * leftovers from earlier false-positive detection or from a separate
 * resolve. Conflicts with no remaining real-disagreement fields are
 * auto-resolved on read so they don't sit in the UI as ghosts.
 */
export function getConflicts(): SyncConflict[] {
  const db = getDb();
  const rows = db.getAllSync<any>(
    'SELECT * FROM _conflicts WHERE resolved_at IS NULL ORDER BY created_at DESC',
  );
  const out: SyncConflict[] = [];
  const now = new Date().toISOString();
  for (const r of rows) {
    const local = JSON.parse(r.local_data);
    const server = JSON.parse(r.server_data);
    const declared: string[] = JSON.parse(r.conflicting_fields);
    const stillConflicting = declared.filter(
      (f) => !valuesEqual(f, local[f], server[f]),
    );
    if (stillConflicting.length === 0) {
      // No disagreement remains — auto-resolve the row so it doesn't
      // linger as a phantom "conflict" in the UI.
      db.runSync(
        'UPDATE _conflicts SET resolved_at = ? WHERE id = ?',
        [now, r.id],
      );
      continue;
    }
    out.push({
      id: r.id,
      table_name: r.table_name,
      row_id: r.row_id,
      local_data: local,
      server_data: server,
      conflicting_fields: stillConflicting,
      created_at: r.created_at,
    });
  }
  return out;
}

/**
 * Resolve a conflict by choosing per-field which version to keep.
 * `choices` maps field name → 'local' | 'server'.
 */
export function resolveConflict(
  conflictId: number,
  choices: Record<string, 'local' | 'server'>,
): void {
  const db = getDb();
  const conflict = db.getFirstSync<any>(
    'SELECT * FROM _conflicts WHERE id = ?', [conflictId],
  );
  if (!conflict) return;

  const localData = JSON.parse(conflict.local_data);
  const serverData = JSON.parse(conflict.server_data);
  const now = new Date().toISOString();

  // Build the merged row: for each conflicting field, pick the chosen version
  const updates: string[] = [];
  const values: any[] = [];
  for (const [field, choice] of Object.entries(choices)) {
    const val = choice === 'local' ? localData[field] : serverData[field];
    updates.push(`${field} = ?`);
    values.push((field === 'opened' || field === 'damaged') ? (val ? 1 : 0) : val);
  }
  updates.push('_synced = 0', '_changed_fields = ?', '_local_updated_at = ?');
  values.push(JSON.stringify(Object.keys(choices)), now);
  values.push(conflict.row_id);

  db.runSync(
    `UPDATE ${conflict.table_name} SET ${updates.join(', ')} WHERE id = ?`,
    values,
  );

  // Enqueue for push (merged result goes to server)
  enqueueChange(conflict.table_name, conflict.row_id, 'UPDATE', Object.keys(choices));

  // Mark conflict resolved
  db.runSync('UPDATE _conflicts SET resolved_at = ? WHERE id = ?', [now, conflictId]);
}

/**
 * Resolve a conflict by keeping ALL local values (discard server changes).
 */
export function resolveConflictKeepLocal(conflictId: number): void {
  const db = getDb();
  const conflict = db.getFirstSync<any>(
    'SELECT * FROM _conflicts WHERE id = ?', [conflictId],
  );
  if (!conflict) return;

  const fields = JSON.parse(conflict.conflicting_fields);
  const choices: Record<string, 'local'> = {};
  for (const f of fields) choices[f] = 'local';
  resolveConflict(conflictId, choices);
}

/**
 * Resolve a conflict by taking ALL server values (discard local changes).
 */
export function resolveConflictTakeServer(conflictId: number): void {
  const db = getDb();
  const conflict = db.getFirstSync<any>(
    'SELECT * FROM _conflicts WHERE id = ?', [conflictId],
  );
  if (!conflict) return;

  const fields = JSON.parse(conflict.conflicting_fields);
  const choices: Record<string, 'server'> = {};
  for (const f of fields) choices[f] = 'server';
  resolveConflict(conflictId, choices);
}

/**
 * Push all pending local changes to Supabase. Processes the sync queue
 * in order. Each successful push marks the entry. Failures are skipped
 * and retried on the next cycle.
 */
export async function pushSync(): Promise<{ pushed: number; failed: number }> {
  // Cloud sync push is gated on an active subscription. Pull is still
  // allowed (free for us, prevents ghost-row drift). Pending queue stays
  // intact for future renew — when the user resubscribes, the next cycle
  // pushes everything that built up while they were lapsed.
  // Lazy require breaks the circular import (see comment near imports).
  const { isCloudEnabledNow } = require('./subscription') as typeof import('./subscription');
  if (!isCloudEnabledNow()) {
    return { pushed: 0, failed: 0 };
  }

  // Drain any deferred image uploads first — items captured while the
  // user's subscription was lapsed currently hold `image_url='local:...'`
  // pointing at the local cache. Replacing those with real Supabase
  // Storage URLs BEFORE we read items rows below means the push payload
  // already carries the correct cloud URL. The safety filter further
  // down strips any local: URL that slipped through (e.g. a flush
  // failure mid-way) so the server never sees the synthetic prefix.
  try {
    const { flushDeferredImageUploads } = require('./storage') as typeof import('./storage');
    await flushDeferredImageUploads();
  } catch (e) {
    console.warn('[sync] flushDeferredImageUploads failed', e);
  }

  const db = getDb();
  const pending = db.getAllSync<{
    id: number;
    table_name: string;
    row_id: string;
    operation: string;
    changed_fields: string | null;
  }>('SELECT * FROM _sync_queue WHERE pushed_at IS NULL ORDER BY id ASC');

  // Rows with unresolved conflicts must NOT be auto-pushed — the user
  // has to resolve the conflict first. Otherwise the local value would
  // silently overwrite the server, destroying the concurrent change
  // that caused the conflict in the first place.
  const conflictedKeys = new Set(
    db.getAllSync<{ table_name: string; row_id: string }>(
      'SELECT table_name, row_id FROM _conflicts WHERE resolved_at IS NULL',
    ).map((c) => `${c.table_name}:${c.row_id}`),
  );

  let pushed = 0;
  let failed = 0;
  const now = new Date().toISOString();

  for (const entry of pending) {
    if (conflictedKeys.has(`${entry.table_name}:${entry.row_id}`)) {
      // Skip — user must resolve the conflict before we push.
      continue;
    }
    try {
      if (entry.operation === 'INSERT') {
        const row = db.getFirstSync<any>(
          `SELECT * FROM ${entry.table_name} WHERE id = ?`,
          [entry.row_id],
        );
        if (row) {
          // Strip sync metadata columns before pushing
          const { _synced, _changed_fields, _deleted_at, _local_updated_at, ...clean } = row;
          // Convert SQLite booleans back
          if ('opened' in clean) clean.opened = !!clean.opened;
          if ('damaged' in clean) clean.damaged = !!clean.damaged;
          // Safety: a deferred-local image URI must never reach the
          // server. flushDeferredImageUploads runs at the top of pushSync
          // and normally converts these, but if its upload failed mid-way
          // the row still carries `local:...`. Strip to NULL rather than
          // garbage so peers/pulls don't render a broken image. The
          // image_url will be re-set on the next sync after the upload
          // finally succeeds (followed by another push entry for that row).
          if (typeof clean.image_url === 'string' && clean.image_url.startsWith('local:')) {
            clean.image_url = null;
          }
          // Tables with secondary unique keys need explicit onConflict so the
          // upsert UPDATEs instead of failing on a duplicate-key error.
          // custom_products has unique (warehouse_id, barcode) — two clients
          // scanning the same product generate different ids but the same
          // logical row.
          const upsertOpts = entry.table_name === 'custom_products'
            ? { onConflict: 'warehouse_id,barcode' }
            : undefined;
          const { error } = await supabase
            .from(entry.table_name)
            .upsert(clean, upsertOpts as any);
          if (error) throw error;
        }
      } else if (entry.operation === 'UPDATE') {
        const row = db.getFirstSync<any>(
          `SELECT * FROM ${entry.table_name} WHERE id = ?`,
          [entry.row_id],
        );
        if (row) {
          const fields = entry.changed_fields ? JSON.parse(entry.changed_fields) : [];
          const patch: Record<string, any> = {};
          for (const f of fields) {
            if (f in row) {
              patch[f] = (f === 'opened' || f === 'damaged') ? !!row[f] : row[f];
            }
          }
          // Same safety as the INSERT branch: never push a `local:`
          // deferred-image URI to the server.
          if (typeof patch.image_url === 'string' && patch.image_url.startsWith('local:')) {
            patch.image_url = null;
          }
          if (Object.keys(patch).length > 0) {
            // For composite PK tables (warehouse_members), use different approach
            const { error } = await supabase
              .from(entry.table_name)
              .update(patch)
              .eq('id', entry.row_id);
            if (error) throw error;
          }
        }
      } else if (entry.operation === 'DELETE') {
        const { error } = await supabase
          .from(entry.table_name)
          .delete()
          .eq('id', entry.row_id);
        // Ignore "not found" errors on delete (row might already be gone).
        // String-coerce defensively — Supabase errors have been observed
        // with non-string `message` fields under some conditions and
        // Hermes can segfault on String.prototype.includes with malformed
        // StringPrimitives.
        if (error && !String(error.message ?? '').includes('0 rows')) throw error;
      }

      // Mark as pushed
      db.runSync('UPDATE _sync_queue SET pushed_at = ? WHERE id = ?', [now, entry.id]);
      // Mark row as synced
      db.runSync(
        `UPDATE ${entry.table_name} SET _synced = 1, _changed_fields = NULL WHERE id = ?`,
        [entry.row_id],
      );
      pushed++;
    } catch (e: any) {
      failed++;
      _lastPushError = `${entry.table_name} ${entry.operation} ${entry.row_id?.slice(0, 8)}: ${e?.message ?? String(e)}`;
      // Will retry on next sync cycle
    }
  }

  return { pushed, failed };
}

// Last push error — exposed so the debug overlay / status bar can show
// why pending changes aren't draining. Cleared on successful full drain.
let _lastPushError: string | null = null;
export function getLastPushError(): string | null {
  return _lastPushError;
}
export function clearLastPushError(): void {
  _lastPushError = null;
}

// ---- Pull sync: Supabase → local -----------------------------------------

/**
 * Incremental pull: fetch rows modified on the server since our last
 * pull and upsert into SQLite. Locally modified rows (_synced = 0)
 * are flagged as conflicts instead of being overwritten.
 */
export async function pullSync(userId: string): Promise<{ pulled: number; conflicts: number }> {
  const db = getDb();
  let pulled = 0;
  let conflicts = 0;

  // Guard: without an active Supabase session, every query hits RLS with
  // no auth token and silently returns an empty array. If we treated that
  // as authoritative we'd wipe the user's local memberships / boxes /
  // items. "Continue offline" is exactly this state — skip pull entirely,
  // there is nothing meaningful to sync anyway.
  const { data: sessData } = await supabase.auth.getSession();
  if (!sessData.session) return { pulled: 0, conflicts: 0 };

  // --- Refresh the user's own memberships first.
  // A freshly accepted invitation (on this or another device) must show
  // up here before we can pull data for that warehouse. We also pick up
  // role changes and removals.
  try {
    const { data: myMemberships, error: memErr } = await supabase
      .from('warehouse_members')
      .select('*, warehouses(*)')
      .eq('user_id', userId);
    if (memErr) {
      console.warn('[sync] memberships pull failed:', memErr.message);
    }
    if (myMemberships) {
      // Upsert warehouses referenced by memberships.
      for (const m of myMemberships as any[]) {
        const w = m.warehouses;
        if (w) {
          db.runSync(
            `INSERT OR REPLACE INTO warehouses (id, owner_id, name, created_at, readiness_goal_days, _synced, _local_updated_at)
             VALUES (?, ?, ?, ?, ?, 1, ?)`,
            [w.id, w.owner_id, w.name, w.created_at, w.readiness_goal_days ?? 14, new Date().toISOString()],
          );
        }
      }
      // Replace the caller's own membership rows with the server snapshot:
      // delete stale rows (user was kicked), upsert current ones.
      const activeWarehouseIds = new Set(
        (myMemberships as any[]).map((m) => m.warehouse_id),
      );
      const localMine = db.getAllSync<{ warehouse_id: string }>(
        'SELECT warehouse_id FROM warehouse_members WHERE user_id = ?',
        [userId],
      );
      for (const row of localMine) {
        if (!activeWarehouseIds.has(row.warehouse_id)) {
          db.runSync(
            'DELETE FROM warehouse_members WHERE warehouse_id = ? AND user_id = ?',
            [row.warehouse_id, userId],
          );
        }
      }
      for (const m of myMemberships as any[]) {
        db.runSync(
          `INSERT OR REPLACE INTO warehouse_members (warehouse_id, user_id, role, joined_at, _synced)
           VALUES (?, ?, ?, ?, 1)`,
          [m.warehouse_id, m.user_id, m.role, m.joined_at],
        );
      }
    }
  } catch { /* non-fatal */ }

  // Get warehouse IDs the user is a member of
  const memberships = db.getAllSync<{ warehouse_id: string }>(
    'SELECT warehouse_id FROM warehouse_members WHERE user_id = ? AND _deleted_at IS NULL',
    [userId],
  );
  const warehouseIds = memberships.map((m) => m.warehouse_id);
  if (warehouseIds.length === 0) return { pulled: 0, conflicts: 0 };

  const now = new Date().toISOString();

  // --- Pull ALL members of shared warehouses + their user profiles.
  // Settings → members list reads locally; without this the user only ever
  // sees themselves in warehouses they share. Member management flows
  // directly server-side (no local queue), so snapshot-replace is safe.
  try {
    const { data: allMembers } = await supabase
      .from('warehouse_members')
      .select('*')
      .in('warehouse_id', warehouseIds);
    if (allMembers) {
      // Replace members for these warehouses with the server snapshot.
      for (const wid of warehouseIds) {
        db.runSync(
          'DELETE FROM warehouse_members WHERE warehouse_id = ?',
          [wid],
        );
      }
      for (const m of allMembers as any[]) {
        db.runSync(
          `INSERT OR REPLACE INTO warehouse_members (warehouse_id, user_id, role, joined_at, _synced)
           VALUES (?, ?, ?, ?, 1)`,
          [m.warehouse_id, m.user_id, m.role, m.joined_at],
        );
      }
      // Backfill user profiles we don't already have so display_name/email render.
      const userIds = Array.from(new Set((allMembers as any[]).map((m) => m.user_id)));
      if (userIds.length > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('*')
          .in('id', userIds);
        for (const u of (users ?? []) as any[]) {
          db.runSync(
            `INSERT OR REPLACE INTO users (id, email, display_name, avatar_url, created_at, _synced)
             VALUES (?, ?, ?, ?, ?, 1)`,
            [u.id, u.email, u.display_name, u.avatar_url, u.created_at],
          );
        }
      }
    }
  } catch { /* non-fatal */ }

  // Pull ALL boxes for the user's warehouses — no `updated_at` filter.
  // Incremental pulls used to miss boxes that were created long ago
  // but only just became accessible to this user (e.g., they were
  // added to an existing warehouse): the boxes' updated_at predates
  // this client's lastBoxPull, so the `gt(...)` filter excluded them.
  // Volume is small at household scale, so full-pull is the safe call.
  const { data: serverBoxes, error: boxErr } = await supabase
    .from('boxes')
    .select('*')
    .in('warehouse_id', warehouseIds);
  if (boxErr) {
    console.warn('[sync] boxes pull failed:', boxErr.message);
  }

  for (const sb of (serverBoxes ?? []) as any[]) {
    const local = db.getFirstSync<any>(
      'SELECT * FROM boxes WHERE id = ?', [sb.id],
    );
    if (local && local._synced === 0) {
      // Local has unsynced changes. Determine real conflicts vs auto-mergeable
      // server changes using the baseline captured in the queue (timestamp +
      // per-field) — this avoids false positives when the local user edited
      // a row whose updated_at on the server was incidentally bumped by
      // another field's change.
      const localFields: string[] = local._changed_fields
        ? JSON.parse(local._changed_fields)
        : [];
      const baseline = getRowBaseline(db, 'boxes', sb.id);
      const boxFields = ['name', 'location'];

      // Fast path: server hasn't moved since our baseline. Our local edits
      // are the only changes — nothing to merge or flag.
      if (baseline?.updated_at && sb.updated_at === baseline.updated_at) {
        continue;
      }

      // For each locally-changed field, conflict only if server actually
      // changed it (i.e. server.value != baseline.value) AND we still
      // disagree with the server. If our edit landed on the same value
      // the server has, there's no disagreement to surface.
      const realConflicts = localFields.filter((f) => {
        if (valuesEqual(f, local[f], sb[f])) return false;
        if (!baseline || !(f in baseline.values)) {
          // No baseline captured (legacy queue entries) — fall back to
          // value-only diff to stay safe.
          return findDiffFields(local, sb, [f]).length > 0;
        }
        return !valuesEqual(f, baseline.values[f], sb[f]);
      });

      // Server-changed fields the user didn't touch can be safely auto-merged
      // into local.
      const autoMergeFields = boxFields.filter((f) => {
        if (localFields.includes(f)) return false;
        return findDiffFields(local, sb, [f]).length > 0;
      });

      if (realConflicts.length > 0) {
        db.runSync(
          `INSERT INTO _conflicts (table_name, row_id, local_data, server_data, conflicting_fields)
           VALUES (?, ?, ?, ?, ?)`,
          ['boxes', sb.id, JSON.stringify(local), JSON.stringify(sb), JSON.stringify(realConflicts)],
        );
        conflicts++;
      } else if (autoMergeFields.length > 0) {
        for (const f of autoMergeFields) {
          db.runSync(`UPDATE boxes SET ${f} = ? WHERE id = ?`, [sb[f], sb.id]);
        }
        db.runSync('UPDATE boxes SET updated_at = ? WHERE id = ?', [sb.updated_at, sb.id]);
        pulled++;
      }
      continue;
    }
    db.runSync(
      `INSERT OR REPLACE INTO boxes (id, warehouse_id, name, location, qr_code, nearest_expiry, item_count, created_at, updated_at, _synced, _local_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [sb.id, sb.warehouse_id, sb.name, sb.location, sb.qr_code, sb.nearest_expiry, sb.item_count, sb.created_at, sb.updated_at, now],
    );
    pulled++;
  }

  // Detect server-side hard deletes: any local box with `_synced=1` that
  // isn't in the server's full snapshot is a ghost (server deleted it
  // but our local pull never knew). Skip `_synced=0` rows — those are
  // the user's own pending creates that haven't reached server yet.
  // Boxes-only — items below get the same treatment.
  if (!boxErr && warehouseIds.length > 0) {
    const serverBoxIds = new Set((serverBoxes ?? []).map((b: any) => b.id));
    const localSynced = db.getAllSync<{ id: string }>(
      `SELECT id FROM boxes
       WHERE warehouse_id IN (${warehouseIds.map(() => '?').join(',')})
         AND _synced = 1 AND _deleted_at IS NULL`,
      warehouseIds,
    );
    for (const { id } of localSynced) {
      if (serverBoxIds.has(id)) continue;
      console.warn('[sync] cleaning ghost box', id.slice(0, 8));
      // Cascade items in the ghost box, but only those that are
      // already synced — keep `_synced=0` rows so the user doesn't
      // silently lose pending creates (they'll fail to push and
      // surface via the sync status bar instead).
      db.runSync('DELETE FROM items WHERE box_id = ? AND _synced = 1', [id]);
      db.runSync('DELETE FROM boxes WHERE id = ?', [id]);
      pulled++;
    }
  }

  // Pull ALL items for the user's warehouses via the boxes!inner join,
  // not via local boxIds. Two reasons we did this rebuild:
  //  1. Local boxIds list is built from SQLite — if the box wasn't yet
  //     pulled into SQLite (e.g. brand-new sharing scenarios), items in
  //     it would be silently skipped.
  //  2. The lastItemPull `gt(...)` filter skipped items the user just
  //     gained access to but whose updated_at predates the cursor —
  //     same root cause as the boxes incremental bug above.
  // The inner join also doubles as an RLS sanity check: we only get
  // items whose box's warehouse the user is a member of.
  {
    const { data: serverItems, error: itemErr } = await supabase
      .from('items')
      .select('*, boxes!inner(warehouse_id)')
      .in('boxes.warehouse_id', warehouseIds);
    if (itemErr) {
      console.warn('[sync] items pull failed:', itemErr.message);
    }

    const itemMergeFields = ['name', 'quantity', 'unit', 'expiry_date', 'barcode', 'image_url', 'category', 'notes', 'opened', 'damaged', 'pack_count', 'last_verified', 'box_id'];

    for (const row of (serverItems ?? []) as any[]) {
      // Strip the joined `boxes` relation so it doesn't leak into the
      // conflict snapshot or any per-field comparisons.
      const { boxes: _, ...si } = row;
      const local = db.getFirstSync<any>(
        'SELECT * FROM items WHERE id = ?', [si.id],
      );
      if (local && local._synced === 0) {
        const localFields: string[] = local._changed_fields
          ? JSON.parse(local._changed_fields)
          : [];
        const baseline = getRowBaseline(db, 'items', si.id);

        // Fast path: server hasn't moved since our baseline.
        if (baseline?.updated_at && si.updated_at === baseline.updated_at) {
          continue;
        }

        const realConflicts = localFields.filter((f) => {
          // Local already matches server — both sides ended up at the
          // same value (e.g. user typed the same number locally that
          // someone else pushed). The algorithm would otherwise flag
          // this as a conflict because the baseline differs from the
          // server, but there's nothing to disagree about.
          if (valuesEqual(f, local[f], si[f])) return false;
          if (!baseline || !(f in baseline.values)) {
            return findDiffFields(local, si, [f]).length > 0;
          }
          return !valuesEqual(f, baseline.values[f], si[f]);
        });

        // Promote coupled-field conflicts (items: quantity + unit) so the
        // /conflicts UI shows a single combined picker rather than two
        // separately-resolvable rows that could leave 25 paired with kg.
        const allDiffFieldsItem = itemMergeFields.filter(
          (f) => findDiffFields(local, si, [f]).length > 0,
        );
        promoteCoupledConflicts('items', realConflicts, allDiffFieldsItem);

        const autoMergeFields = itemMergeFields.filter((f) => {
          if (localFields.includes(f)) return false;
          if (realConflicts.includes(f)) return false; // promoted into conflict
          return findDiffFields(local, si, [f]).length > 0;
        });

        if (realConflicts.length > 0) {
          db.runSync(
            `INSERT INTO _conflicts (table_name, row_id, local_data, server_data, conflicting_fields)
             VALUES (?, ?, ?, ?, ?)`,
            ['items', si.id, JSON.stringify(local), JSON.stringify(si), JSON.stringify(realConflicts)],
          );
          conflicts++;
        } else if (autoMergeFields.length > 0) {
          for (const f of autoMergeFields) {
            const val = (f === 'opened' || f === 'damaged') ? (si[f] ? 1 : 0) : si[f];
            db.runSync(`UPDATE items SET ${f} = ? WHERE id = ?`, [val, si.id]);
          }
          db.runSync('UPDATE items SET updated_at = ? WHERE id = ?', [si.updated_at, si.id]);
          pulled++;
        }
        continue;
      }
      db.runSync(
        `INSERT OR REPLACE INTO items (id, box_id, name, quantity, unit, expiry_date, barcode, image_url, category, notes, opened, damaged, pack_count, last_verified, added_by, created_at, updated_at, _synced, _local_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [si.id, si.box_id, si.name, si.quantity, si.unit, si.expiry_date, si.barcode, si.image_url, si.category, si.notes, si.opened ? 1 : 0, si.damaged ? 1 : 0, si.pack_count, si.last_verified, si.added_by, si.created_at, si.updated_at, now],
      );
      pulled++;
    }

    // Same ghost cleanup for items: anything `_synced=1` locally that
    // isn't in the server's full snapshot was deleted server-side and
    // our local needs to follow. Skip `_synced=0` (pending push).
    if (!itemErr) {
      const serverItemIds = new Set((serverItems ?? []).map((row: any) => row.id));
      // Scope the cleanup to items in boxes that belong to user's
      // warehouses, so we don't accidentally touch rows from boxes the
      // server returned no items for due to a transient permission glitch.
      const localBoxes = db.getAllSync<{ id: string }>(
        `SELECT id FROM boxes
         WHERE warehouse_id IN (${warehouseIds.map(() => '?').join(',')})
           AND _deleted_at IS NULL`,
        warehouseIds,
      );
      if (localBoxes.length > 0) {
        const boxIdParams = localBoxes.map(() => '?').join(',');
        const localSyncedItems = db.getAllSync<{ id: string }>(
          `SELECT id FROM items
           WHERE box_id IN (${boxIdParams})
             AND _synced = 1 AND _deleted_at IS NULL`,
          localBoxes.map((b) => b.id),
        );
        for (const { id } of localSyncedItems) {
          if (serverItemIds.has(id)) continue;
          console.warn('[sync] cleaning ghost item', id.slice(0, 8));
          db.runSync('DELETE FROM items WHERE id = ?', [id]);
          pulled++;
        }
      }
    }
  }

  // --- Household members + shopping list (Sprint 6) ---
  // Lightweight last-write-wins pull: overwrite locally-synced rows with
  // the server snapshot, leave pending-local (_synced=0) rows alone, and
  // GC local synced rows the server no longer has. These tables are
  // low-conflict (small, rarely-edited) so per-field merge is overkill.
  const myWarehouseIds = db
    .getAllSync<{ warehouse_id: string }>(
      'SELECT warehouse_id FROM warehouse_members WHERE user_id = ?',
      [userId],
    )
    .map((r) => r.warehouse_id);

  if (myWarehouseIds.length > 0) {
    // Household members
    const { data: hm, error: hmErr } = await supabase
      .from('household_members')
      .select('*')
      .in('warehouse_id', myWarehouseIds);
    if (!hmErr && hm) {
      const serverIds = new Set<string>();
      for (const m of hm as any[]) {
        serverIds.add(m.id);
        const local = db.getFirstSync<{ _synced: number }>(
          'SELECT _synced FROM household_members WHERE id = ?',
          [m.id],
        );
        if (local && local._synced === 0) continue; // pending local edit wins
        db.runSync(
          `INSERT OR REPLACE INTO household_members (id, warehouse_id, name, daily_kcal, daily_water_l, kind, created_at, _synced)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
          [m.id, m.warehouse_id, m.name, m.daily_kcal, m.daily_water_l, m.kind ?? null, m.created_at],
        );
        pulled++;
      }
      const localHm = db.getAllSync<{ id: string }>(
        `SELECT id FROM household_members WHERE warehouse_id IN (${myWarehouseIds.map(() => '?').join(',')}) AND _synced = 1 AND _deleted_at IS NULL`,
        myWarehouseIds,
      );
      for (const { id } of localHm) {
        if (!serverIds.has(id)) db.runSync('DELETE FROM household_members WHERE id = ?', [id]);
      }
    }

    // Shopping list items
    const { data: sl, error: slErr } = await supabase
      .from('shopping_list_items')
      .select('*')
      .in('warehouse_id', myWarehouseIds);
    if (!slErr && sl) {
      const serverIds = new Set<string>();
      for (const s of sl as any[]) {
        serverIds.add(s.id);
        const local = db.getFirstSync<{ _synced: number }>(
          'SELECT _synced FROM shopping_list_items WHERE id = ?',
          [s.id],
        );
        if (local && local._synced === 0) continue;
        db.runSync(
          `INSERT OR REPLACE INTO shopping_list_items (id, warehouse_id, label, category, source, source_ref, quantity, checked, created_at, _synced)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [s.id, s.warehouse_id, s.label, s.category, s.source, s.source_ref, s.quantity, s.checked ? 1 : 0, s.created_at],
        );
        pulled++;
      }
      const localSl = db.getAllSync<{ id: string }>(
        `SELECT id FROM shopping_list_items WHERE warehouse_id IN (${myWarehouseIds.map(() => '?').join(',')}) AND _synced = 1 AND _deleted_at IS NULL`,
        myWarehouseIds,
      );
      for (const { id } of localSl) {
        if (!serverIds.has(id)) db.runSync('DELETE FROM shopping_list_items WHERE id = ?', [id]);
      }
    }

    // Custom products (cached barcode products + aggregate par levels). Same
    // last-write-wins shape — small, rarely-edited, low-conflict.
    const { data: cp, error: cpErr } = await supabase
      .from('custom_products')
      .select('*')
      .in('warehouse_id', myWarehouseIds);
    if (!cpErr && cp) {
      const serverIds = new Set<string>();
      for (const p of cp as any[]) {
        serverIds.add(p.id);
        const local = db.getFirstSync<{ _synced: number }>(
          'SELECT _synced FROM custom_products WHERE id = ?',
          [p.id],
        );
        if (local && local._synced === 0) continue; // pending local edit wins
        db.runSync(
          `INSERT OR REPLACE INTO custom_products (id, warehouse_id, barcode, name, category, image_url, typical_expiry_days, created_by, created_at, min_quantity, _synced)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [p.id, p.warehouse_id, p.barcode, p.name, p.category, p.image_url, p.typical_expiry_days, p.created_by, p.created_at, p.min_quantity ?? null],
        );
        pulled++;
      }
      const localCp = db.getAllSync<{ id: string }>(
        `SELECT id FROM custom_products WHERE warehouse_id IN (${myWarehouseIds.map(() => '?').join(',')}) AND _synced = 1 AND _deleted_at IS NULL`,
        myWarehouseIds,
      );
      for (const { id } of localCp) {
        if (!serverIds.has(id)) db.runSync('DELETE FROM custom_products WHERE id = ?', [id]);
      }
    }

    // Custom checklists (Sprint 7) — same last-write-wins shape.
    const whParams = myWarehouseIds.map(() => '?').join(',');

    const { data: cl, error: clErr } = await supabase
      .from('checklists').select('*').in('warehouse_id', myWarehouseIds);
    if (!clErr && cl) {
      const serverIds = new Set<string>();
      for (const c of cl as any[]) {
        serverIds.add(c.id);
        const local = db.getFirstSync<{ _synced: number }>('SELECT _synced FROM checklists WHERE id = ?', [c.id]);
        if (local && local._synced === 0) continue;
        db.runSync(
          `INSERT OR REPLACE INTO checklists (id, warehouse_id, name, is_seed, goal_days, created_at, updated_at, _synced)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
          [c.id, c.warehouse_id, c.name, c.is_seed ? 1 : 0, c.goal_days ?? null, c.created_at, c.updated_at],
        );
        pulled++;
      }
      const localRows = db.getAllSync<{ id: string }>(
        `SELECT id FROM checklists WHERE warehouse_id IN (${whParams}) AND _synced = 1 AND _deleted_at IS NULL`,
        myWarehouseIds,
      );
      for (const { id } of localRows) {
        if (!serverIds.has(id)) db.runSync('DELETE FROM checklists WHERE id = ?', [id]);
      }
    }

    const { data: ce, error: ceErr } = await supabase
      .from('checklist_entries').select('*').in('warehouse_id', myWarehouseIds);
    if (!ceErr && ce) {
      const serverIds = new Set<string>();
      for (const e of ce as any[]) {
        serverIds.add(e.id);
        const local = db.getFirstSync<{ _synced: number }>('SELECT _synced FROM checklist_entries WHERE id = ?', [e.id]);
        if (local && local._synced === 0) continue;
        db.runSync(
          `INSERT OR REPLACE INTO checklist_entries (id, checklist_id, warehouse_id, seed_key, label, group_name, category, keywords, quantified, rationale, sort_order, created_at, updated_at, _synced)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [e.id, e.checklist_id, e.warehouse_id, e.seed_key ?? null, e.label, e.group_name ?? null, e.category ?? null, e.keywords ?? null, e.quantified ?? null, e.rationale ?? null, e.sort_order ?? 0, e.created_at, e.updated_at],
        );
        pulled++;
      }
      const localRows = db.getAllSync<{ id: string }>(
        `SELECT id FROM checklist_entries WHERE warehouse_id IN (${whParams}) AND _synced = 1 AND _deleted_at IS NULL`,
        myWarehouseIds,
      );
      for (const { id } of localRows) {
        if (!serverIds.has(id)) db.runSync('DELETE FROM checklist_entries WHERE id = ?', [id]);
      }
    }

    const { data: cs, error: csErr } = await supabase
      .from('checklist_satisfactions').select('*').in('warehouse_id', myWarehouseIds);
    if (!csErr && cs) {
      const serverIds = new Set<string>();
      for (const s of cs as any[]) {
        serverIds.add(s.id);
        const local = db.getFirstSync<{ _synced: number }>('SELECT _synced FROM checklist_satisfactions WHERE id = ?', [s.id]);
        if (local && local._synced === 0) continue;
        db.runSync(
          `INSERT OR REPLACE INTO checklist_satisfactions (id, checklist_entry_id, warehouse_id, item_id, mode, created_at, _synced)
           VALUES (?, ?, ?, ?, ?, ?, 1)`,
          [s.id, s.checklist_entry_id, s.warehouse_id, s.item_id ?? null, s.mode, s.created_at],
        );
        pulled++;
      }
      const localRows = db.getAllSync<{ id: string }>(
        `SELECT id FROM checklist_satisfactions WHERE warehouse_id IN (${whParams}) AND _synced = 1 AND _deleted_at IS NULL`,
        myWarehouseIds,
      );
      for (const { id } of localRows) {
        if (!serverIds.has(id)) db.runSync('DELETE FROM checklist_satisfactions WHERE id = ?', [id]);
      }
    }

    const { data: wc, error: wcErr } = await supabase
      .from('warehouse_checklists').select('*').in('warehouse_id', myWarehouseIds);
    if (!wcErr && wc) {
      const serverIds = new Set<string>();
      for (const w of wc as any[]) {
        serverIds.add(w.id);
        const local = db.getFirstSync<{ _synced: number }>('SELECT _synced FROM warehouse_checklists WHERE id = ?', [w.id]);
        if (local && local._synced === 0) continue;
        db.runSync(
          `INSERT OR REPLACE INTO warehouse_checklists (id, warehouse_id, checklist_id, created_at, _synced)
           VALUES (?, ?, ?, ?, 1)`,
          [w.id, w.warehouse_id, w.checklist_id, w.created_at],
        );
        pulled++;
      }
      const localRows = db.getAllSync<{ id: string }>(
        `SELECT id FROM warehouse_checklists WHERE warehouse_id IN (${whParams}) AND _synced = 1 AND _deleted_at IS NULL`,
        myWarehouseIds,
      );
      for (const { id } of localRows) {
        if (!serverIds.has(id)) db.runSync('DELETE FROM warehouse_checklists WHERE id = ?', [id]);
      }
    }
  }

  // Update sync timestamps
  for (const t of ['boxes', 'items', 'household_members', 'shopping_list_items', 'custom_products', 'checklists', 'checklist_entries', 'checklist_satisfactions', 'warehouse_checklists']) {
    db.runSync(
      'INSERT OR REPLACE INTO _sync_meta (table_name, last_pulled_at) VALUES (?, ?)',
      [t, now],
    );
  }

  return { pulled, conflicts };
}

// ---- Full sync cycle ------------------------------------------------------

/**
 * Run a complete sync cycle: pull remote updates first so concurrent
 * server changes can be compared against local edits (and flagged as
 * conflicts when they overlap), THEN push local changes so pushSync can
 * skip anything that's now in conflict. Push-first would silently clobber
 * the server whenever both sides touched the same field offline.
 */
export async function runSyncCycle(userId: string): Promise<{
  pushed: number;
  pushFailed: number;
  pulled: number;
  conflicts: number;
}> {
  setSyncStatus('syncing');
  try {
    const pullResult = await pullSync(userId);
    const pushResult = await pushSync();
    setSyncStatus('idle');

    // Prefetch product images in the background after a successful pull
    if (pullResult.pulled > 0) {
      const db = getDb();
      const rows = db.getAllSync<{ image_url: string }>(
        'SELECT image_url FROM items WHERE image_url IS NOT NULL AND _deleted_at IS NULL',
      );
      prefetchImages(rows.map((r) => r.image_url)).catch(() => {});
    }

    return {
      pushed: pushResult.pushed,
      pushFailed: pushResult.failed,
      pulled: pullResult.pulled,
      conflicts: pullResult.conflicts,
    };
  } catch (e) {
    setSyncStatus('error');
    throw e;
  }
}
