// ============================================================================
// Kalta – Local SQLite write operations
// Each write goes to SQLite immediately (offline-capable), then enqueues
// a sync entry. Background sync pushes to Supabase when online.
//
// ID generation: UUIDs are created locally via expo-crypto so rows exist
// in SQLite before the server sees them. Server insert uses the same ID.
// ============================================================================
import * as Crypto from 'expo-crypto';
import { getDb } from './localDb';
import { enqueueChange } from './sync';
import { supabase } from './supabase';
import type { Box, Item, Category, Unit, Warehouse, CustomProduct, InventorySession, InventoryLine, InventoryLineStatus, HouseholdMember, MemberKind, ShoppingListItem, ShoppingSource, Checklist, ChecklistEntry, SatisfactionMode } from '@/src/types/database';

function genId(): string {
  return Crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

// Tables whose schema has an `updated_at` column. We tag each captured
// before-snapshot with the row's updated_at at edit time so the pull
// engine can use it as a baseline timestamp when detecting conflicts.
const TABLES_WITH_UPDATED_AT = new Set(['items', 'boxes']);

/**
 * Snapshot a row's current values for the named fields, BEFORE applying
 * an UPDATE. The result is passed to enqueueChange's payload so the
 * pending-changes screen can show "old → new" diffs and the sync engine
 * can use the captured `updated_at` as a baseline for conflict detection.
 * Booleans are normalized to true/false so they render the same as the
 * after-value read by the pending screen.
 *
 * Field names are whitelisted by a strict regex to keep the interpolated
 * SELECT free of injection — `_sync_queue` and the source columns are
 * the only sources of these names but defending here is cheap.
 */
function captureBefore(
  table: string,
  id: string,
  fields: string[],
): Record<string, any> | undefined {
  const db = getDb();
  const safeFields = fields.filter((f) => /^[a-z_][a-z0-9_]*$/i.test(f));
  if (safeFields.length === 0 && !TABLES_WITH_UPDATED_AT.has(table)) return undefined;
  const cols = [...safeFields];
  if (TABLES_WITH_UPDATED_AT.has(table)) cols.push('updated_at');
  try {
    const row = db.getFirstSync<any>(
      `SELECT ${cols.join(', ')} FROM ${table} WHERE id = ?`,
      [id],
    );
    if (!row) return undefined;
    const out: Record<string, any> = {};
    for (const f of safeFields) {
      const v = row[f];
      if (f === 'opened' || f === 'damaged') out[f] = !!v;
      else out[f] = v ?? null;
    }
    if (TABLES_WITH_UPDATED_AT.has(table) && row.updated_at != null) {
      out.updated_at = row.updated_at;
    }
    return out;
  } catch {
    return undefined;
  }
}

/**
 * Find an item in `targetBoxId` that matches source's product identity
 * (name + barcode + expiry + category + unit + pack_count + opened).
 * SQLite version of the Supabase `findMatchingItemInBox`.
 */
function findMatchingItemLocal(
  targetBoxId: string,
  src: { name: string; barcode: string | null; expiry_date: string | null; category: string | null; unit: string; pack_count: number | null; opened: boolean },
): string | null {
  const db = getDb();
  const rows = db.getAllSync<any>(
    `SELECT id, name, barcode, expiry_date, category, unit, pack_count, opened
     FROM items WHERE box_id = ? AND _deleted_at IS NULL`,
    [targetBoxId],
  );
  const match = rows.find(
    (r: any) =>
      r.name === src.name &&
      (r.barcode ?? '') === (src.barcode ?? '') &&
      (r.expiry_date ?? '') === (src.expiry_date ?? '') &&
      (r.category ?? '') === (src.category ?? '') &&
      r.unit === src.unit &&
      (r.pack_count ?? 0) === (src.pack_count ?? 0) &&
      !!r.opened === src.opened,
  );
  return match?.id ?? null;
}

/**
 * Recalculate nearest_expiry and item_count on a box after item changes.
 * Local equivalent of the Supabase `recalc_box_cache()` trigger.
 */
export function recalcBoxCacheLocal(boxId: string): void {
  const db = getDb();
  db.runSync(
    `UPDATE boxes SET
       item_count = (SELECT COUNT(*) FROM items WHERE box_id = ? AND _deleted_at IS NULL),
       nearest_expiry = (SELECT MIN(expiry_date) FROM items WHERE box_id = ? AND _deleted_at IS NULL AND expiry_date IS NOT NULL),
       updated_at = ?
     WHERE id = ?`,
    [boxId, boxId, nowIso(), boxId],
  );
}

// ---- Boxes ----------------------------------------------------------------

export function createBoxLocal(input: {
  warehouse_id: string;
  name: string;
  location?: string | null;
}): Box {
  const db = getDb();
  const id = genId();
  const now = nowIso();
  const qrCode = id; // QR = UUID, same as server default

  db.runSync(
    `INSERT INTO boxes (id, warehouse_id, name, location, qr_code, nearest_expiry, item_count, created_at, updated_at, _synced, _local_updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?, 0, ?)`,
    [id, input.warehouse_id, input.name, input.location ?? null, qrCode, now, now, now],
  );

  enqueueChange('boxes', id, 'INSERT');

  return {
    id,
    warehouse_id: input.warehouse_id,
    name: input.name,
    location: input.location ?? null,
    qr_code: qrCode,
    nearest_expiry: null,
    item_count: 0,
    created_at: now,
    updated_at: now,
  };
}

export function updateBoxLocal(
  id: string,
  patch: Partial<Pick<Box, 'name' | 'location'>>,
): Box {
  const db = getDb();
  const now = nowIso();

  // Filter no-op edits — same logic as updateItemLocal.
  const before = captureBefore('boxes', id, Object.keys(patch));
  const effectivePatch: Partial<Pick<Box, 'name' | 'location'>> = {};
  for (const [key, val] of Object.entries(patch) as [keyof typeof patch, any][]) {
    const oldVal = before?.[key];
    if ((val ?? null) !== (oldVal === undefined ? null : oldVal)) {
      (effectivePatch as any)[key] = val;
    }
  }

  if (Object.keys(effectivePatch).length === 0) {
    return db.getFirstSync<Box>(
      'SELECT id, warehouse_id, name, location, qr_code, nearest_expiry, item_count, created_at, updated_at FROM boxes WHERE id = ?',
      [id],
    )!;
  }

  const fields: string[] = [];
  const values: any[] = [];
  if (effectivePatch.name !== undefined) { fields.push('name = ?'); values.push(effectivePatch.name); }
  if (effectivePatch.location !== undefined) { fields.push('location = ?'); values.push(effectivePatch.location); }
  fields.push('updated_at = ?', '_synced = 0', '_local_updated_at = ?');
  values.push(now, now, id);

  const changedFields = Object.keys(effectivePatch);
  db.runSync(`UPDATE boxes SET ${fields.join(', ')} WHERE id = ?`, values);

  // Track changed fields for per-field merge
  const existing = db.getFirstSync<{ _changed_fields: string | null }>(
    'SELECT _changed_fields FROM boxes WHERE id = ?', [id],
  );
  const prev = existing?._changed_fields ? JSON.parse(existing._changed_fields) : [];
  const merged = [...new Set([...prev, ...changedFields])];
  db.runSync('UPDATE boxes SET _changed_fields = ? WHERE id = ?', [JSON.stringify(merged), id]);

  const beforeForQueue = before
    ? {
        ...Object.fromEntries(
          changedFields.filter((f) => f in before).map((f) => [f, before[f]]),
        ),
        ...(before.updated_at != null ? { updated_at: before.updated_at } : {}),
      }
    : undefined;
  enqueueChange(
    'boxes',
    id,
    'UPDATE',
    changedFields,
    beforeForQueue && Object.keys(beforeForQueue).length > 0 ? { before: beforeForQueue } : undefined,
  );

  return db.getFirstSync<Box>(
    'SELECT id, warehouse_id, name, location, qr_code, nearest_expiry, item_count, created_at, updated_at FROM boxes WHERE id = ?',
    [id],
  )!;
}

export function deleteBoxLocal(id: string): void {
  const db = getDb();
  const now = nowIso();
  db.runSync(
    'UPDATE boxes SET _deleted_at = ?, _synced = 0, _local_updated_at = ? WHERE id = ?',
    [now, now, id],
  );
  // Also soft-delete all items in this box
  db.runSync(
    'UPDATE items SET _deleted_at = ?, _synced = 0, _local_updated_at = ? WHERE box_id = ? AND _deleted_at IS NULL',
    [now, now, id],
  );
  enqueueChange('boxes', id, 'DELETE');
}

// ---- Items ----------------------------------------------------------------

export function addItemLocal(
  boxId: string,
  addedBy: string,
  input: {
    name: string;
    quantity: number;
    unit: Unit;
    expiry_date?: string | null;
    barcode?: string | null;
    image_url?: string | null;
    category?: Category | null;
    notes?: string | null;
    opened?: boolean;
    damaged?: boolean;
    pack_count?: number | null;
    energy_kcal_per_100g?: number | null;
    net_weight_g?: number | null;
    min_quantity?: number | null;
  },
): Item {
  const db = getDb();
  const id = genId();
  const now = nowIso();

  db.runSync(
    `INSERT INTO items (id, box_id, name, quantity, unit, expiry_date, barcode, image_url, category, notes, opened, damaged, pack_count, last_verified, added_by, created_at, updated_at, energy_kcal_per_100g, net_weight_g, min_quantity, _synced, _local_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      id, boxId, input.name, input.quantity, input.unit,
      input.expiry_date ?? null, input.barcode ?? null, input.image_url ?? null,
      input.category ?? null, input.notes ?? null,
      input.opened ? 1 : 0, input.damaged ? 1 : 0,
      input.pack_count ?? null, addedBy, now, now,
      input.energy_kcal_per_100g ?? null, input.net_weight_g ?? null, input.min_quantity ?? null,
      now,
    ],
  );

  recalcBoxCacheLocal(boxId);
  enqueueChange('items', id, 'INSERT');

  return {
    id, box_id: boxId, name: input.name, quantity: input.quantity, unit: input.unit,
    expiry_date: input.expiry_date ?? null, barcode: input.barcode ?? null,
    image_url: input.image_url ?? null, category: (input.category ?? null) as Category | null,
    notes: input.notes ?? null, opened: input.opened ?? false, damaged: input.damaged ?? false,
    pack_count: input.pack_count ?? null, last_verified: null,
    added_by: addedBy, created_at: now, updated_at: now,
    energy_kcal_per_100g: input.energy_kcal_per_100g ?? null,
    net_weight_g: input.net_weight_g ?? null,
    min_quantity: input.min_quantity ?? null,
  };
}

/**
 * Add an item, merging into an existing row in the box when the product
 * IDENTITY matches (name + barcode + expiry_date + category + unit +
 * pack_count + opened). Same product with a DIFFERENT expiry is a different
 * batch → a new row (needed for FIFO rotation). Same identity → bump quantity.
 */
export function addOrMergeItemLocal(
  boxId: string,
  addedBy: string,
  input: Parameters<typeof addItemLocal>[2],
): Item {
  const db = getDb();
  const matchId = findMatchingItemLocal(boxId, {
    name: input.name,
    barcode: input.barcode ?? null,
    expiry_date: input.expiry_date ?? null,
    category: input.category ?? null,
    unit: input.unit,
    pack_count: input.pack_count ?? null,
    opened: input.opened ?? false,
  });
  if (!matchId) return addItemLocal(boxId, addedBy, input);

  const now = nowIso();
  const match = db.getFirstSync<any>('SELECT * FROM items WHERE id = ?', [matchId]);
  const prevQty = match?.quantity ?? 0;
  const nextQty = prevQty + input.quantity;
  db.runSync(
    'UPDATE items SET quantity = ?, updated_at = ?, _synced = 0, _local_updated_at = ? WHERE id = ?',
    [nextQty, now, now, matchId],
  );
  enqueueChange('items', matchId, 'UPDATE', ['quantity'], { before: { quantity: prevQty } });
  recalcBoxCacheLocal(boxId);
  return { ...(match as Item), quantity: nextQty, updated_at: now };
}

export function addItemsBatchLocal(
  boxId: string,
  addedBy: string,
  inputs: {
    name: string;
    quantity: number;
    unit: Unit;
    expiry_date?: string | null;
    barcode?: string | null;
    image_url?: string | null;
    category?: Category | null;
    notes?: string | null;
    pack_count?: number | null;
    energy_kcal_per_100g?: number | null;
    net_weight_g?: number | null;
    min_quantity?: number | null;
  }[],
): Item[] {
  if (inputs.length === 0) return [];
  const db = getDb();
  const items: Item[] = [];

  db.execSync('BEGIN TRANSACTION;');
  try {
    for (const input of inputs) {
      const item = addItemLocal(boxId, addedBy, input);
      items.push(item);
    }
    db.execSync('COMMIT;');
  } catch (e) {
    db.execSync('ROLLBACK;');
    throw e;
  }

  return items;
}

export function updateItemLocal(
  id: string,
  patch: Record<string, any>,
): Item {
  const db = getDb();
  const now = nowIso();

  // Filter out noop edits — fields the caller submitted but whose value is
  // identical to what's already stored. Saves the queue from useless rows
  // and keeps the pending-changes screen clean. Booleans are normalized
  // before comparison since SQLite stores them as 0/1 ints.
  const before = captureBefore('items', id, Object.keys(patch));
  const effectivePatch: Record<string, any> = {};
  for (const [key, val] of Object.entries(patch)) {
    const oldVal = before?.[key];
    const newNorm = key === 'opened' || key === 'damaged' ? !!val : (val ?? null);
    const oldNorm =
      key === 'opened' || key === 'damaged'
        ? !!oldVal
        : oldVal === undefined
          ? null
          : oldVal;
    if (newNorm !== oldNorm) effectivePatch[key] = val;
  }

  // No-op write — caller submitted unchanged values. Return current row
  // without enqueuing anything.
  if (Object.keys(effectivePatch).length === 0) {
    const row = db.getFirstSync<any>('SELECT * FROM items WHERE id = ?', [id]);
    return { ...row, opened: !!row.opened, damaged: !!row.damaged };
  }

  const fields: string[] = [];
  const values: any[] = [];
  for (const [key, val] of Object.entries(effectivePatch)) {
    if (key === 'opened' || key === 'damaged') {
      fields.push(`${key} = ?`);
      values.push(val ? 1 : 0);
    } else {
      fields.push(`${key} = ?`);
      values.push(val ?? null);
    }
  }
  fields.push('updated_at = ?', '_synced = 0', '_local_updated_at = ?');
  values.push(now, now, id);

  const changedFields = Object.keys(effectivePatch);
  db.runSync(`UPDATE items SET ${fields.join(', ')} WHERE id = ?`, values);

  // Track changed fields
  const existing = db.getFirstSync<{ _changed_fields: string | null; box_id: string }>(
    'SELECT _changed_fields, box_id FROM items WHERE id = ?', [id],
  );
  const prev = existing?._changed_fields ? JSON.parse(existing._changed_fields) : [];
  const merged = [...new Set([...prev, ...changedFields])];
  db.runSync('UPDATE items SET _changed_fields = ? WHERE id = ?', [JSON.stringify(merged), id]);

  if (existing?.box_id) recalcBoxCacheLocal(existing.box_id);
  // Restrict the captured before-snapshot to fields we're actually
  // recording as changed (plus updated_at as the baseline timestamp).
  // Anything else is noise in the queue payload.
  const beforeForQueue = before
    ? {
        ...Object.fromEntries(
          changedFields.filter((f) => f in before).map((f) => [f, before[f]]),
        ),
        ...(before.updated_at != null ? { updated_at: before.updated_at } : {}),
      }
    : undefined;
  enqueueChange(
    'items',
    id,
    'UPDATE',
    changedFields,
    beforeForQueue && Object.keys(beforeForQueue).length > 0 ? { before: beforeForQueue } : undefined,
  );

  const row = db.getFirstSync<any>('SELECT * FROM items WHERE id = ?', [id]);
  return { ...row, opened: !!row.opened, damaged: !!row.damaged };
}

// ---- Move items -----------------------------------------------------------

export function moveItemQuantityLocal(
  itemId: string,
  quantity: number | 'all',
  targetBoxId: string,
  addedBy: string,
): void {
  const db = getDb();
  const now = nowIso();
  const src = db.getFirstSync<any>('SELECT * FROM items WHERE id = ? AND _deleted_at IS NULL', [itemId]);
  if (!src) throw new Error('Item not found.');

  const moveQty = quantity === 'all' ? src.quantity : Math.min(quantity, src.quantity);
  const movingAll = moveQty >= src.quantity;

  const matchId = findMatchingItemLocal(targetBoxId, {
    ...src, opened: !!src.opened,
  });

  if (matchId) {
    // MERGE into existing target
    const match = db.getFirstSync<any>('SELECT quantity FROM items WHERE id = ?', [matchId]);
    const matchPrevQty = match?.quantity ?? 0;
    db.runSync('UPDATE items SET quantity = ?, updated_at = ?, _synced = 0, _local_updated_at = ? WHERE id = ?',
      [matchPrevQty + moveQty, now, now, matchId]);
    enqueueChange('items', matchId, 'UPDATE', ['quantity'], { before: { quantity: matchPrevQty } });

    if (movingAll) {
      db.runSync('UPDATE items SET _deleted_at = ?, _synced = 0, _local_updated_at = ? WHERE id = ?', [now, now, itemId]);
      enqueueChange('items', itemId, 'DELETE');
    } else {
      db.runSync('UPDATE items SET quantity = ?, updated_at = ?, _synced = 0, _local_updated_at = ? WHERE id = ?',
        [src.quantity - moveQty, now, now, itemId]);
      enqueueChange('items', itemId, 'UPDATE', ['quantity'], { before: { quantity: src.quantity } });
    }
  } else {
    if (movingAll) {
      db.runSync('UPDATE items SET box_id = ?, updated_at = ?, _synced = 0, _local_updated_at = ? WHERE id = ?',
        [targetBoxId, now, now, itemId]);
      enqueueChange('items', itemId, 'UPDATE', ['box_id'], { before: { box_id: src.box_id } });
    } else {
      db.runSync('UPDATE items SET quantity = ?, updated_at = ?, _synced = 0, _local_updated_at = ? WHERE id = ?',
        [src.quantity - moveQty, now, now, itemId]);
      enqueueChange('items', itemId, 'UPDATE', ['quantity'], { before: { quantity: src.quantity } });

      const newId = genId();
      db.runSync(
        `INSERT INTO items (id, box_id, name, quantity, unit, expiry_date, barcode, image_url, category, notes, opened, damaged, pack_count, last_verified, added_by, created_at, updated_at, energy_kcal_per_100g, net_weight_g, min_quantity, _synced, _local_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [newId, targetBoxId, src.name, moveQty, src.unit, src.expiry_date, src.barcode, src.image_url, src.category, src.notes, src.opened, src.damaged, src.pack_count, src.last_verified, addedBy, now, now, src.energy_kcal_per_100g ?? null, src.net_weight_g ?? null, src.min_quantity ?? null, now],
      );
      enqueueChange('items', newId, 'INSERT');
    }
  }

  recalcBoxCacheLocal(src.box_id);
  recalcBoxCacheLocal(targetBoxId);
}

// ---- Open one item --------------------------------------------------------

export function openOneItemLocal(itemId: string, addedBy: string): Item {
  const db = getDb();
  const now = nowIso();
  const src = db.getFirstSync<any>('SELECT * FROM items WHERE id = ? AND _deleted_at IS NULL', [itemId]);
  if (!src) throw new Error('Item not found.');
  if (src.opened) throw new Error('Item is already opened.');
  if (src.unit !== 'pcs' && src.unit !== 'pack') throw new Error('Open action only applies to pcs/pack units.');
  if (src.quantity <= 0) throw new Error('Item has zero quantity.');

  // Find existing opened sibling
  const matchId = findMatchingItemLocal(src.box_id, {
    ...src, opened: true,
  });

  // Decrement or delete source
  if (src.quantity <= 1) {
    db.runSync('UPDATE items SET _deleted_at = ?, _synced = 0, _local_updated_at = ? WHERE id = ?', [now, now, itemId]);
    enqueueChange('items', itemId, 'DELETE');
  } else {
    db.runSync('UPDATE items SET quantity = ?, updated_at = ?, _synced = 0, _local_updated_at = ? WHERE id = ?',
      [src.quantity - 1, now, now, itemId]);
    enqueueChange('items', itemId, 'UPDATE', ['quantity'], { before: { quantity: src.quantity } });
  }

  let resultId: string;
  if (matchId) {
    const match = db.getFirstSync<any>('SELECT quantity FROM items WHERE id = ?', [matchId]);
    const matchPrevQty = match?.quantity ?? 0;
    db.runSync('UPDATE items SET quantity = ?, updated_at = ?, _synced = 0, _local_updated_at = ? WHERE id = ?',
      [matchPrevQty + 1, now, now, matchId]);
    enqueueChange('items', matchId, 'UPDATE', ['quantity'], { before: { quantity: matchPrevQty } });
    resultId = matchId;
  } else {
    resultId = genId();
    db.runSync(
      `INSERT INTO items (id, box_id, name, quantity, unit, expiry_date, barcode, image_url, category, notes, opened, damaged, pack_count, last_verified, added_by, created_at, updated_at, energy_kcal_per_100g, net_weight_g, min_quantity, _synced, _local_updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [resultId, src.box_id, src.name, src.unit, src.expiry_date, src.barcode, src.image_url, src.category, src.notes, src.damaged, src.pack_count, src.last_verified, addedBy, now, now, src.energy_kcal_per_100g ?? null, src.net_weight_g ?? null, src.min_quantity ?? null, now],
    );
    enqueueChange('items', resultId, 'INSERT');
  }

  recalcBoxCacheLocal(src.box_id);
  const row = db.getFirstSync<any>('SELECT * FROM items WHERE id = ?', [resultId]);
  return { ...row, opened: !!row.opened, damaged: !!row.damaged };
}

// ---- Mark condition (split with flags) ------------------------------------

export function markItemConditionLocal(
  itemId: string,
  conditions: { opened: boolean; damaged: boolean; notes: string | null },
  addedBy: string,
): void {
  const db = getDb();
  const now = nowIso();
  const src = db.getFirstSync<any>('SELECT * FROM items WHERE id = ? AND _deleted_at IS NULL', [itemId]);
  if (!src) throw new Error('Item not found.');

  if (src.quantity <= 1) {
    // Single unit — update in place
    db.runSync(
      'UPDATE items SET opened = ?, damaged = ?, notes = ?, updated_at = ?, _synced = 0, _local_updated_at = ? WHERE id = ?',
      [conditions.opened ? 1 : 0, conditions.damaged ? 1 : 0, conditions.notes, now, now, itemId],
    );
    enqueueChange('items', itemId, 'UPDATE', ['opened', 'damaged', 'notes'], {
      before: {
        opened: !!src.opened,
        damaged: !!src.damaged,
        notes: src.notes ?? null,
      },
    });
    return;
  }

  // Split: decrement source, create conditioned copy
  db.runSync('UPDATE items SET quantity = ?, updated_at = ?, _synced = 0, _local_updated_at = ? WHERE id = ?',
    [src.quantity - 1, now, now, itemId]);
  enqueueChange('items', itemId, 'UPDATE', ['quantity'], { before: { quantity: src.quantity } });

  const newId = genId();
  db.runSync(
    `INSERT INTO items (id, box_id, name, quantity, unit, expiry_date, barcode, image_url, category, notes, opened, damaged, pack_count, last_verified, added_by, created_at, updated_at, energy_kcal_per_100g, net_weight_g, min_quantity, _synced, _local_updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [newId, src.box_id, src.name, src.unit, src.expiry_date, src.barcode, src.image_url, src.category, conditions.notes, conditions.opened ? 1 : 0, conditions.damaged ? 1 : 0, src.pack_count, src.last_verified, addedBy, now, now, src.energy_kcal_per_100g ?? null, src.net_weight_g ?? null, src.min_quantity ?? null, now],
  );
  enqueueChange('items', newId, 'INSERT');

  recalcBoxCacheLocal(src.box_id);
}

// ---- Delete item ----------------------------------------------------------

export function deleteItemLocal(id: string): void {
  const db = getDb();
  const now = nowIso();
  const item = db.getFirstSync<{ box_id: string; image_url: string | null }>(
    'SELECT box_id, image_url FROM items WHERE id = ?', [id],
  );

  db.runSync(
    'UPDATE items SET _deleted_at = ?, _synced = 0, _local_updated_at = ? WHERE id = ?',
    [now, now, id],
  );

  if (item?.box_id) recalcBoxCacheLocal(item.box_id);
  enqueueChange('items', id, 'DELETE');

  // Clean up product image (fire-and-forget)
  if (item?.image_url) {
    import('./storage').then(({ deleteProductImage }) => {
      deleteProductImage(item.image_url!).catch(() => {});
    });
  }
}

/**
 * Consume stock (use-it-up rotation): subtract `amount` units, or 'all'.
 * When the row hits zero it's soft-deleted (the batch is gone), otherwise the
 * quantity is decremented. Returns the remaining quantity (0 if removed).
 */
export function consumeItemLocal(itemId: string, amount: number | 'all'): number {
  const db = getDb();
  const item = db.getFirstSync<{ quantity: number }>(
    'SELECT quantity FROM items WHERE id = ? AND _deleted_at IS NULL',
    [itemId],
  );
  if (!item) return 0;
  const next = amount === 'all' ? 0 : Math.max(0, item.quantity - amount);
  if (next <= 0) {
    deleteItemLocal(itemId);
    return 0;
  }
  const now = nowIso();
  db.runSync(
    'UPDATE items SET quantity = ?, updated_at = ?, _synced = 0, _local_updated_at = ? WHERE id = ?',
    [next, now, now, itemId],
  );
  enqueueChange('items', itemId, 'UPDATE', ['quantity'], { before: { quantity: item.quantity } });
  const box = db.getFirstSync<{ box_id: string }>('SELECT box_id FROM items WHERE id = ?', [itemId]);
  if (box?.box_id) recalcBoxCacheLocal(box.box_id);
  return next;
}

// ---- Warehouses -----------------------------------------------------------

export function createWarehouseLocal(ownerId: string, name: string): Warehouse {
  const db = getDb();
  const id = genId();
  const now = nowIso();

  db.runSync(
    `INSERT INTO warehouses (id, owner_id, name, created_at, _synced, _local_updated_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
    [id, ownerId, name, now, now],
  );

  // Also create the owner membership row
  db.runSync(
    `INSERT INTO warehouse_members (warehouse_id, user_id, role, joined_at, _synced)
     VALUES (?, ?, 'owner', ?, 0)`,
    [id, ownerId, now],
  );

  enqueueChange('warehouses', id, 'INSERT');

  return { id, owner_id: ownerId, name, created_at: now, readiness_goal_days: 14 };
}

export function renameWarehouseLocal(id: string, name: string): Warehouse {
  const db = getDb();
  const now = nowIso();

  const before = captureBefore('warehouses', id, ['name']);
  db.runSync(
    `UPDATE warehouses SET name = ?, _synced = 0, _local_updated_at = ? WHERE id = ?`,
    [name, now, id],
  );

  // Track changed fields
  const existing = db.getFirstSync<{ _changed_fields: string | null }>(
    'SELECT _changed_fields FROM warehouses WHERE id = ?', [id],
  );
  const prev = existing?._changed_fields ? JSON.parse(existing._changed_fields) : [];
  const merged = [...new Set([...prev, 'name'])];
  db.runSync('UPDATE warehouses SET _changed_fields = ? WHERE id = ?', [JSON.stringify(merged), id]);

  enqueueChange('warehouses', id, 'UPDATE', ['name'], before ? { before } : undefined);

  return db.getFirstSync<Warehouse>(
    'SELECT id, owner_id, name, created_at, readiness_goal_days FROM warehouses WHERE id = ?', [id],
  )!;
}

/** Update the readiness goal (days) for a warehouse. Sprint 6. */
export function setReadinessGoalLocal(id: string, days: number): void {
  const db = getDb();
  const before = captureBefore('warehouses', id, ['readiness_goal_days']);
  db.runSync(
    `UPDATE warehouses SET readiness_goal_days = ?, _synced = 0, _local_updated_at = ? WHERE id = ?`,
    [days, nowIso(), id],
  );
  const existing = db.getFirstSync<{ _changed_fields: string | null }>(
    'SELECT _changed_fields FROM warehouses WHERE id = ?', [id],
  );
  const prev = existing?._changed_fields ? JSON.parse(existing._changed_fields) : [];
  const merged = [...new Set([...prev, 'readiness_goal_days'])];
  db.runSync('UPDATE warehouses SET _changed_fields = ? WHERE id = ?', [JSON.stringify(merged), id]);
  enqueueChange('warehouses', id, 'UPDATE', ['readiness_goal_days'], before ? { before } : undefined);
}

// ---- Verify items ---------------------------------------------------------

export function verifyItemsLocal(itemIds: string[]): void {
  if (itemIds.length === 0) return;
  const db = getDb();
  const now = nowIso();
  for (const id of itemIds) {
    const before = captureBefore('items', id, ['last_verified']);
    db.runSync(
      'UPDATE items SET last_verified = ?, updated_at = ?, _synced = 0, _local_updated_at = ? WHERE id = ?',
      [now, now, now, id],
    );
    // Track changed fields
    const existing = db.getFirstSync<{ _changed_fields: string | null }>(
      'SELECT _changed_fields FROM items WHERE id = ?', [id],
    );
    const prev = existing?._changed_fields ? JSON.parse(existing._changed_fields) : [];
    const merged = [...new Set([...prev, 'last_verified'])];
    db.runSync('UPDATE items SET _changed_fields = ? WHERE id = ?', [JSON.stringify(merged), id]);
    enqueueChange('items', id, 'UPDATE', ['last_verified'], before ? { before } : undefined);
  }
}

// ---- Inventory sessions ---------------------------------------------------

export function createInventorySessionLocal(
  boxId: string,
  performedBy: string,
): InventorySession {
  const db = getDb();
  const id = genId();
  const now = nowIso();

  db.runSync(
    `INSERT INTO inventory_sessions (id, box_id, performed_by, started_at, completed_at, found_count, missing_count, notes, created_at, _synced)
     VALUES (?, ?, ?, ?, NULL, 0, 0, NULL, ?, 0)`,
    [id, boxId, performedBy, now, now],
  );

  enqueueChange('inventory_sessions', id, 'INSERT');

  return {
    id, box_id: boxId, performed_by: performedBy, started_at: now,
    completed_at: null, found_count: 0, missing_count: 0, notes: null, created_at: now,
  };
}

export function completeInventorySessionLocal(
  sessionId: string,
  lines: { item_id: string | null; item_name: string; item_quantity: number; item_unit: string; found_quantity: number; status: InventoryLineStatus; scanned_barcode: string | null }[],
  foundItemIds: string[],
): void {
  const db = getDb();
  const now = nowIso();
  const foundCount = lines.filter((l) => l.status === 'found').length;
  const missingCount = lines.filter((l) => l.status === 'missing').length;

  // Insert inventory lines
  for (const l of lines) {
    const lineId = genId();
    db.runSync(
      `INSERT INTO inventory_lines (id, session_id, item_id, item_name, item_quantity, item_unit, found_quantity, status, scanned_barcode, created_at, _synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [lineId, sessionId, l.item_id, l.item_name, l.item_quantity, l.item_unit, l.found_quantity, l.status, l.scanned_barcode, now],
    );
    enqueueChange('inventory_lines', lineId, 'INSERT');
  }

  // Mark session complete
  const before = captureBefore('inventory_sessions', sessionId, [
    'completed_at',
    'found_count',
    'missing_count',
  ]);
  db.runSync(
    `UPDATE inventory_sessions SET completed_at = ?, found_count = ?, missing_count = ? WHERE id = ?`,
    [now, foundCount, missingCount, sessionId],
  );
  enqueueChange(
    'inventory_sessions',
    sessionId,
    'UPDATE',
    ['completed_at', 'found_count', 'missing_count'],
    before ? { before } : undefined,
  );

  // Verify found items
  if (foundItemIds.length > 0) {
    verifyItemsLocal(foundItemIds);
  }
}

// ---- Custom products ------------------------------------------------------

export function upsertCustomProductLocal(input: {
  warehouse_id: string;
  barcode: string;
  name: string;
  category?: Category | null;
  image_url?: string | null;
  typical_expiry_days?: number | null;
  created_by: string;
  // Optional cached product attributes — only written when the key is present.
  energy_kcal_per_100g?: number | null;
  net_weight_g?: number | null;
}): CustomProduct {
  const db = getDb();
  const now = nowIso();
  const hasEnergy = 'energy_kcal_per_100g' in input;
  const hasNet = 'net_weight_g' in input;

  // Check if exists
  const existing = db.getFirstSync<{ id: string }>(
    'SELECT id FROM custom_products WHERE warehouse_id = ? AND barcode = ? AND _deleted_at IS NULL',
    [input.warehouse_id, input.barcode],
  );

  if (existing) {
    const cols = ['name', 'category', 'image_url', 'typical_expiry_days'];
    const vals: any[] = [input.name, input.category ?? null, input.image_url ?? null, input.typical_expiry_days ?? null];
    if (hasEnergy) {
      cols.push('energy_kcal_per_100g');
      vals.push(input.energy_kcal_per_100g ?? null);
    }
    if (hasNet) {
      cols.push('net_weight_g');
      vals.push(input.net_weight_g ?? null);
    }
    const before = captureBefore('custom_products', existing.id, cols);
    db.runSync(
      `UPDATE custom_products SET ${cols.map((c) => `${c} = ?`).join(', ')}, _synced = 0 WHERE id = ?`,
      [...vals, existing.id],
    );
    enqueueChange(
      'custom_products',
      existing.id,
      'UPDATE',
      cols,
      before ? { before } : undefined,
    );
    return db.getFirstSync<CustomProduct>(
      'SELECT id, warehouse_id, barcode, name, category, image_url, typical_expiry_days, created_by, created_at, min_quantity, energy_kcal_per_100g, net_weight_g FROM custom_products WHERE id = ?',
      [existing.id],
    )!;
  }

  const id = genId();
  db.runSync(
    `INSERT INTO custom_products (id, warehouse_id, barcode, name, category, image_url, typical_expiry_days, created_by, created_at, energy_kcal_per_100g, net_weight_g, _synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [id, input.warehouse_id, input.barcode, input.name, input.category ?? null, input.image_url ?? null, input.typical_expiry_days ?? null, input.created_by, now, input.energy_kcal_per_100g ?? null, input.net_weight_g ?? null],
  );
  enqueueChange('custom_products', id, 'INSERT');

  return {
    id, warehouse_id: input.warehouse_id, barcode: input.barcode, name: input.name,
    category: (input.category ?? null) as Category | null, image_url: input.image_url ?? null,
    typical_expiry_days: input.typical_expiry_days ?? null, created_by: input.created_by, created_at: now,
    min_quantity: null, energy_kcal_per_100g: input.energy_kcal_per_100g ?? null, net_weight_g: input.net_weight_g ?? null,
  };
}

/**
 * Propagate product-level attribute edits (energy / net weight) from the
 * product cache to every stocked instance of that barcode in the warehouse.
 * Reuses updateItemLocal per row so each change is enqueued for sync and the
 * box caches recalc. Returns the number of items updated.
 */
export function applyProductAttributesToItemsLocal(
  warehouseId: string,
  barcode: string,
  patch: { energy_kcal_per_100g?: number | null; net_weight_g?: number | null },
): number {
  const db = getDb();
  const rows = db.getAllSync<{ id: string }>(
    `SELECT i.id
     FROM items i
     JOIN boxes b ON b.id = i.box_id
     WHERE b.warehouse_id = ? AND i.barcode = ? AND i._deleted_at IS NULL AND b._deleted_at IS NULL`,
    [warehouseId, barcode],
  );
  for (const { id } of rows) {
    updateItemLocal(id, patch);
  }
  return rows.length;
}

export function deleteCustomProductLocal(id: string): void {
  const db = getDb();
  const now = nowIso();
  db.runSync(
    'UPDATE custom_products SET _deleted_at = ?, _synced = 0 WHERE id = ?',
    [now, id],
  );
  enqueueChange('custom_products', id, 'DELETE');
}

/**
 * Set the aggregate par level for a barcoded product. Updates the existing
 * custom_products row, or creates a minimal one (using the item's name /
 * category as fallback) if the product was never cached.
 */
export function setCustomProductMinQuantityLocal(input: {
  warehouse_id: string;
  barcode: string;
  min: number | null;
  name: string;
  category?: Category | null;
  created_by: string;
  // Optional cached product attributes. Only written when the key is present,
  // so callers that only touch the par level don't wipe a cached value.
  energy_kcal_per_100g?: number | null;
  net_weight_g?: number | null;
}): void {
  const db = getDb();
  const now = nowIso();
  const hasEnergy = 'energy_kcal_per_100g' in input;
  const hasNet = 'net_weight_g' in input;
  const existing = db.getFirstSync<{ id: string }>(
    'SELECT id FROM custom_products WHERE warehouse_id = ? AND barcode = ? AND _deleted_at IS NULL',
    [input.warehouse_id, input.barcode],
  );
  if (existing) {
    const cols = ['min_quantity'];
    const vals: (number | null)[] = [input.min];
    if (hasEnergy) {
      cols.push('energy_kcal_per_100g');
      vals.push(input.energy_kcal_per_100g ?? null);
    }
    if (hasNet) {
      cols.push('net_weight_g');
      vals.push(input.net_weight_g ?? null);
    }
    const before = captureBefore('custom_products', existing.id, cols);
    db.runSync(
      `UPDATE custom_products SET ${cols.map((c) => `${c} = ?`).join(', ')}, _synced = 0 WHERE id = ?`,
      [...vals, existing.id],
    );
    enqueueChange(
      'custom_products',
      existing.id,
      'UPDATE',
      cols,
      before ? { before } : undefined,
    );
    return;
  }
  const id = genId();
  db.runSync(
    `INSERT INTO custom_products (id, warehouse_id, barcode, name, category, image_url, typical_expiry_days, created_by, created_at, min_quantity, energy_kcal_per_100g, net_weight_g, _synced)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, 0)`,
    [id, input.warehouse_id, input.barcode, input.name, input.category ?? null, input.created_by, now, input.min, input.energy_kcal_per_100g ?? null, input.net_weight_g ?? null],
  );
  enqueueChange('custom_products', id, 'INSERT');
}

// ---- Household members (Sprint 6) -----------------------------------------

export function addHouseholdMemberLocal(input: {
  warehouse_id: string;
  name: string;
  daily_kcal: number;
  daily_water_l: number;
  kind?: MemberKind | null;
}): HouseholdMember {
  const db = getDb();
  const id = genId();
  const now = nowIso();
  const kind = input.kind ?? null;
  db.runSync(
    `INSERT INTO household_members (id, warehouse_id, name, daily_kcal, daily_water_l, kind, created_at, _synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    [id, input.warehouse_id, input.name, input.daily_kcal, input.daily_water_l, kind, now],
  );
  enqueueChange('household_members', id, 'INSERT');
  return {
    id,
    warehouse_id: input.warehouse_id,
    name: input.name,
    daily_kcal: input.daily_kcal,
    daily_water_l: input.daily_water_l,
    kind,
    created_at: now,
  };
}

export function updateHouseholdMemberLocal(
  id: string,
  patch: Partial<Pick<HouseholdMember, 'name' | 'daily_kcal' | 'daily_water_l' | 'kind'>>,
): void {
  const db = getDb();
  const fields = Object.keys(patch) as (keyof typeof patch)[];
  if (fields.length === 0) return;
  const before = captureBefore('household_members', id, fields as string[]);
  const setClause = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => patch[f] as string | number);
  db.runSync(
    `UPDATE household_members SET ${setClause}, _synced = 0 WHERE id = ?`,
    [...values, id],
  );
  enqueueChange(
    'household_members',
    id,
    'UPDATE',
    fields as string[],
    before ? { before } : undefined,
  );
}

export function deleteHouseholdMemberLocal(id: string): void {
  const db = getDb();
  db.runSync(
    'UPDATE household_members SET _deleted_at = ?, _synced = 0 WHERE id = ?',
    [nowIso(), id],
  );
  enqueueChange('household_members', id, 'DELETE');
}

// ---- Shopping list (Sprint 6) ---------------------------------------------

export function addShoppingItemLocal(input: {
  warehouse_id: string;
  label: string;
  category?: Category | null;
  source?: ShoppingSource;
  source_ref?: string | null;
  quantity?: number | null;
  reason?: string | null;
}): ShoppingListItem {
  const db = getDb();
  const id = genId();
  const now = nowIso();
  const source = input.source ?? 'manual';
  const reason = input.reason ?? null;
  db.runSync(
    `INSERT INTO shopping_list_items (id, warehouse_id, label, category, source, source_ref, quantity, checked, reason, created_at, _synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0)`,
    [id, input.warehouse_id, input.label, input.category ?? null, source, input.source_ref ?? null, input.quantity ?? null, reason, now],
  );
  enqueueChange('shopping_list_items', id, 'INSERT');
  return {
    id, warehouse_id: input.warehouse_id, label: input.label,
    category: (input.category ?? null) as Category | null, source,
    source_ref: input.source_ref ?? null, quantity: input.quantity ?? null,
    checked: false, reason, created_at: now,
  };
}

export function setShoppingItemCheckedLocal(id: string, checked: boolean): void {
  const db = getDb();
  db.runSync(
    'UPDATE shopping_list_items SET checked = ?, _synced = 0 WHERE id = ?',
    [checked ? 1 : 0, id],
  );
  enqueueChange('shopping_list_items', id, 'UPDATE', ['checked']);
}

export function deleteShoppingItemLocal(id: string): void {
  const db = getDb();
  db.runSync(
    'UPDATE shopping_list_items SET _deleted_at = ?, _synced = 0 WHERE id = ?',
    [nowIso(), id],
  );
  enqueueChange('shopping_list_items', id, 'DELETE');
}

// ---- Custom checklists (Sprint 7) -----------------------------------------
// LWW sync (no per-field merge / conflict tracking) — these tables are small
// and low-conflict, same shape as custom_products / shopping list.

export function createChecklistLocal(input: {
  warehouse_id: string;
  name: string;
  is_seed?: boolean;
  goal_days?: number | null;
}): Checklist {
  const db = getDb();
  const id = genId();
  const now = nowIso();
  const isSeed = input.is_seed ?? false;
  const goal = input.goal_days ?? null;
  db.runSync(
    `INSERT INTO checklists (id, warehouse_id, name, is_seed, goal_days, created_at, updated_at, _synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    [id, input.warehouse_id, input.name, isSeed ? 1 : 0, goal, now, now],
  );
  enqueueChange('checklists', id, 'INSERT');
  return {
    id, warehouse_id: input.warehouse_id, name: input.name,
    is_seed: isSeed, goal_days: goal, created_at: now, updated_at: now,
  };
}

export function updateChecklistLocal(
  id: string,
  patch: Partial<Pick<Checklist, 'name' | 'goal_days'>>,
): void {
  const db = getDb();
  const fields = Object.keys(patch) as (keyof typeof patch)[];
  if (fields.length === 0) return;
  const now = nowIso();
  const setClause = [...fields.map((f) => `${f} = ?`), 'updated_at = ?'].join(', ');
  const values = [...fields.map((f) => patch[f] as string | number | null), now];
  db.runSync(`UPDATE checklists SET ${setClause}, _synced = 0 WHERE id = ?`, [...values, id]);
  enqueueChange('checklists', id, 'UPDATE', [...(fields as string[]), 'updated_at']);
}

export function deleteChecklistLocal(id: string): void {
  const db = getDb();
  const now = nowIso();
  db.runSync('UPDATE checklists SET _deleted_at = ?, _synced = 0 WHERE id = ?', [now, id]);
  enqueueChange('checklists', id, 'DELETE');
  // Soft-delete child entries locally too (server cascades on the FK).
  const entries = db.getAllSync<{ id: string }>(
    'SELECT id FROM checklist_entries WHERE checklist_id = ? AND _deleted_at IS NULL',
    [id],
  );
  for (const e of entries) {
    db.runSync('UPDATE checklist_entries SET _deleted_at = ?, _synced = 0 WHERE id = ?', [now, e.id]);
    enqueueChange('checklist_entries', e.id, 'DELETE');
  }
}

export function createChecklistEntryLocal(input: {
  checklist_id: string;
  warehouse_id: string;
  label: string;
  group_name?: string | null;
  category?: Category | null;
  keywords?: string[];
  quantified?: 'food' | 'water' | null;
  rationale?: string | null;
  sort_order?: number;
  seed_key?: string | null;
}): ChecklistEntry {
  const db = getDb();
  const id = genId();
  const now = nowIso();
  const keywords = input.keywords ?? [];
  const sortOrder = input.sort_order ?? 0;
  db.runSync(
    `INSERT INTO checklist_entries (id, checklist_id, warehouse_id, seed_key, label, group_name, category, keywords, quantified, rationale, sort_order, created_at, updated_at, _synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      id, input.checklist_id, input.warehouse_id, input.seed_key ?? null, input.label,
      input.group_name ?? null, input.category ?? null, JSON.stringify(keywords),
      input.quantified ?? null, input.rationale ?? null, sortOrder, now, now,
    ],
  );
  enqueueChange('checklist_entries', id, 'INSERT');
  return {
    id, checklist_id: input.checklist_id, warehouse_id: input.warehouse_id,
    seed_key: input.seed_key ?? null, label: input.label, group_name: input.group_name ?? null,
    category: (input.category ?? null) as Category | null, keywords,
    quantified: input.quantified ?? null, rationale: input.rationale ?? null,
    sort_order: sortOrder, created_at: now, updated_at: now,
  };
}

export function updateChecklistEntryLocal(
  id: string,
  patch: Partial<{
    label: string;
    group_name: string | null;
    category: Category | null;
    keywords: string[];
    quantified: 'food' | 'water' | null;
    rationale: string | null;
    sort_order: number;
  }>,
): void {
  const db = getDb();
  const fields = Object.keys(patch) as (keyof typeof patch)[];
  if (fields.length === 0) return;
  const now = nowIso();
  const setClause = [...fields.map((f) => `${f} = ?`), 'updated_at = ?'].join(', ');
  const values = fields.map((f) =>
    f === 'keywords' ? JSON.stringify(patch.keywords ?? []) : (patch[f] as string | number | null),
  );
  db.runSync(
    `UPDATE checklist_entries SET ${setClause}, _synced = 0 WHERE id = ?`,
    [...values, now, id],
  );
  enqueueChange('checklist_entries', id, 'UPDATE', [...(fields as string[]), 'updated_at']);
}

export function deleteChecklistEntryLocal(id: string): void {
  const db = getDb();
  db.runSync('UPDATE checklist_entries SET _deleted_at = ?, _synced = 0 WHERE id = ?', [nowIso(), id]);
  enqueueChange('checklist_entries', id, 'DELETE');
}

/**
 * Set the single satisfaction for an entry (pin / force_stocked / force_missing
 * / not_applicable). Clears any existing satisfaction first — an entry has at
 * most one. Pass mode=null to just clear.
 */
export function setChecklistSatisfactionLocal(input: {
  checklist_entry_id: string;
  warehouse_id: string;
  mode: SatisfactionMode | null;
  item_id?: string | null;
}): void {
  const db = getDb();
  const now = nowIso();
  const existing = db.getAllSync<{ id: string }>(
    'SELECT id FROM checklist_satisfactions WHERE checklist_entry_id = ? AND _deleted_at IS NULL',
    [input.checklist_entry_id],
  );
  for (const e of existing) {
    db.runSync('UPDATE checklist_satisfactions SET _deleted_at = ?, _synced = 0 WHERE id = ?', [now, e.id]);
    enqueueChange('checklist_satisfactions', e.id, 'DELETE');
  }
  if (input.mode == null) return;
  const id = genId();
  db.runSync(
    `INSERT INTO checklist_satisfactions (id, checklist_entry_id, warehouse_id, item_id, mode, created_at, _synced)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [id, input.checklist_entry_id, input.warehouse_id, input.item_id ?? null, input.mode, now],
  );
  enqueueChange('checklist_satisfactions', id, 'INSERT');
}

export function addWarehouseChecklistLocal(input: {
  warehouse_id: string;
  checklist_id: string;
}): void {
  const db = getDb();
  const existing = db.getFirstSync<{ id: string }>(
    'SELECT id FROM warehouse_checklists WHERE warehouse_id = ? AND checklist_id = ? AND _deleted_at IS NULL',
    [input.warehouse_id, input.checklist_id],
  );
  if (existing) return;
  const id = genId();
  db.runSync(
    `INSERT INTO warehouse_checklists (id, warehouse_id, checklist_id, created_at, _synced)
     VALUES (?, ?, ?, ?, 0)`,
    [id, input.warehouse_id, input.checklist_id, nowIso()],
  );
  enqueueChange('warehouse_checklists', id, 'INSERT');
}

export function removeWarehouseChecklistLocal(warehouseId: string, checklistId: string): void {
  const db = getDb();
  const rows = db.getAllSync<{ id: string }>(
    'SELECT id FROM warehouse_checklists WHERE warehouse_id = ? AND checklist_id = ? AND _deleted_at IS NULL',
    [warehouseId, checklistId],
  );
  for (const r of rows) {
    db.runSync('UPDATE warehouse_checklists SET _deleted_at = ?, _synced = 0 WHERE id = ?', [nowIso(), r.id]);
    enqueueChange('warehouse_checklists', r.id, 'DELETE');
  }
}
