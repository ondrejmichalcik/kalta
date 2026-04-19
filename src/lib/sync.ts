// ============================================================================
// Stockr – Sync engine
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
        `INSERT OR REPLACE INTO warehouses (id, owner_id, name, created_at, _synced, _local_updated_at)
         VALUES (?, ?, ?, ?, 1, ?)`,
        [w.id, w.owner_id, w.name, w.created_at, now],
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
        `INSERT OR REPLACE INTO items (id, box_id, name, quantity, unit, expiry_date, barcode, image_url, category, notes, opened, damaged, pack_count, last_verified, added_by, created_at, updated_at, _synced, _local_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [i.id, i.box_id, i.name, i.quantity, i.unit, i.expiry_date, i.barcode, i.image_url, i.category, i.notes, i.opened ? 1 : 0, i.damaged ? 1 : 0, i.pack_count, i.last_verified, i.added_by, i.created_at, i.updated_at, now],
      );
    }

    // Custom products
    for (const p of (customProducts ?? []) as any[]) {
      db.runSync(
        `INSERT OR REPLACE INTO custom_products (id, warehouse_id, barcode, name, category, image_url, typical_expiry_days, created_by, created_at, _synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [p.id, p.warehouse_id, p.barcode, p.name, p.category, p.image_url, p.typical_expiry_days, p.created_by, p.created_at],
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
    const tables = ['users', 'warehouses', 'warehouse_members', 'boxes', 'items', 'custom_products', 'invitations', 'inventory_sessions'];
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
function scheduleAutoPush() {
  if (_pushTimer) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => {
    _pushTimer = null;
    const prev = _currentStatus;
    setSyncStatus('syncing');
    pushSync()
      .catch(() => {})
      .finally(() => {
        // Only drop back to idle if we were the one who set syncing.
        if (_currentStatus === 'syncing') setSyncStatus(prev === 'error' ? 'idle' : prev);
      });
  }, 500);
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

const PUSHABLE_TABLES = ['warehouses', 'boxes', 'items', 'custom_products', 'inventory_sessions', 'inventory_lines'] as const;

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
 * Get all unresolved conflicts.
 */
export function getConflicts(): SyncConflict[] {
  const db = getDb();
  return db.getAllSync<any>(
    'SELECT * FROM _conflicts WHERE resolved_at IS NULL ORDER BY created_at DESC',
  ).map((r: any) => ({
    ...r,
    local_data: JSON.parse(r.local_data),
    server_data: JSON.parse(r.server_data),
    conflicting_fields: JSON.parse(r.conflicting_fields),
  }));
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
    const { data: myMemberships } = await supabase
      .from('warehouse_members')
      .select('*, warehouses(*)')
      .eq('user_id', userId);
    if (myMemberships) {
      // Upsert warehouses referenced by memberships.
      for (const m of myMemberships as any[]) {
        const w = m.warehouses;
        if (w) {
          db.runSync(
            `INSERT OR REPLACE INTO warehouses (id, owner_id, name, created_at, _synced, _local_updated_at)
             VALUES (?, ?, ?, ?, 1, ?)`,
            [w.id, w.owner_id, w.name, w.created_at, new Date().toISOString()],
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

  // Pull boxes
  const lastBoxPull = db.getFirstSync<{ last_pulled_at: string | null }>(
    'SELECT last_pulled_at FROM _sync_meta WHERE table_name = ?', ['boxes'],
  )?.last_pulled_at;

  let boxQuery = supabase.from('boxes').select('*').in('warehouse_id', warehouseIds);
  if (lastBoxPull) boxQuery = boxQuery.gt('updated_at', lastBoxPull);
  const { data: serverBoxes } = await boxQuery;

  for (const sb of (serverBoxes ?? []) as any[]) {
    const local = db.getFirstSync<any>(
      'SELECT * FROM boxes WHERE id = ?', [sb.id],
    );
    if (local && local._synced === 0) {
      // Local has unsynced changes — try auto-merge or flag conflict
      const localFields = local._changed_fields ? JSON.parse(local._changed_fields) : [];
      const serverDiff = findDiffFields(local, sb, ['name', 'location']);
      const overlap = localFields.filter((f: string) => serverDiff.includes(f));

      if (overlap.length === 0 && serverDiff.length > 0) {
        // Auto-merge: no overlapping fields — apply server's non-conflicting changes
        for (const f of serverDiff) {
          db.runSync(`UPDATE boxes SET ${f} = ? WHERE id = ?`, [sb[f], sb.id]);
        }
        db.runSync('UPDATE boxes SET updated_at = ? WHERE id = ?', [sb.updated_at, sb.id]);
        pulled++;
      } else if (overlap.length > 0) {
        // Real conflict — store for user resolution
        db.runSync(
          `INSERT INTO _conflicts (table_name, row_id, local_data, server_data, conflicting_fields)
           VALUES (?, ?, ?, ?, ?)`,
          ['boxes', sb.id, JSON.stringify(local), JSON.stringify(sb), JSON.stringify(overlap)],
        );
        conflicts++;
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

  // Pull items
  const lastItemPull = db.getFirstSync<{ last_pulled_at: string | null }>(
    'SELECT last_pulled_at FROM _sync_meta WHERE table_name = ?', ['items'],
  )?.last_pulled_at;

  const boxIds = db.getAllSync<{ id: string }>(
    'SELECT id FROM boxes WHERE warehouse_id IN (' + warehouseIds.map(() => '?').join(',') + ') AND _deleted_at IS NULL',
    warehouseIds,
  ).map((b) => b.id);

  if (boxIds.length > 0) {
    let itemQuery = supabase.from('items').select('*').in('box_id', boxIds);
    if (lastItemPull) itemQuery = itemQuery.gt('updated_at', lastItemPull);
    const { data: serverItems } = await itemQuery;

    const itemMergeFields = ['name', 'quantity', 'unit', 'expiry_date', 'barcode', 'image_url', 'category', 'notes', 'opened', 'damaged', 'pack_count', 'last_verified', 'box_id'];

    for (const si of (serverItems ?? []) as any[]) {
      const local = db.getFirstSync<any>(
        'SELECT * FROM items WHERE id = ?', [si.id],
      );
      if (local && local._synced === 0) {
        const localFields = local._changed_fields ? JSON.parse(local._changed_fields) : [];
        const serverDiff = findDiffFields(local, si, itemMergeFields);
        const overlap = localFields.filter((f: string) => serverDiff.includes(f));

        if (overlap.length === 0 && serverDiff.length > 0) {
          // Auto-merge
          for (const f of serverDiff) {
            const val = (f === 'opened' || f === 'damaged') ? (si[f] ? 1 : 0) : si[f];
            db.runSync(`UPDATE items SET ${f} = ? WHERE id = ?`, [val, si.id]);
          }
          db.runSync('UPDATE items SET updated_at = ? WHERE id = ?', [si.updated_at, si.id]);
          pulled++;
        } else if (overlap.length > 0) {
          db.runSync(
            `INSERT INTO _conflicts (table_name, row_id, local_data, server_data, conflicting_fields)
             VALUES (?, ?, ?, ?, ?)`,
            ['items', si.id, JSON.stringify(local), JSON.stringify(si), JSON.stringify(overlap)],
          );
          conflicts++;
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
  }

  // Update sync timestamps
  for (const t of ['boxes', 'items']) {
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
