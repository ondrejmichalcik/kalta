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
import type { Box, Item, Category, Unit, Warehouse, CustomProduct, InventorySession, InventoryLine, InventoryLineStatus } from '@/src/types/database';

function genId(): string {
  return Crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
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
  const fields: string[] = [];
  const values: any[] = [];

  if (patch.name !== undefined) { fields.push('name = ?'); values.push(patch.name); }
  if (patch.location !== undefined) { fields.push('location = ?'); values.push(patch.location); }
  fields.push('updated_at = ?', '_synced = 0', '_local_updated_at = ?');
  values.push(now, now, id);

  const changedFields = Object.keys(patch);
  db.runSync(`UPDATE boxes SET ${fields.join(', ')} WHERE id = ?`, values);

  // Track changed fields for per-field merge
  const existing = db.getFirstSync<{ _changed_fields: string | null }>(
    'SELECT _changed_fields FROM boxes WHERE id = ?', [id],
  );
  const prev = existing?._changed_fields ? JSON.parse(existing._changed_fields) : [];
  const merged = [...new Set([...prev, ...changedFields])];
  db.runSync('UPDATE boxes SET _changed_fields = ? WHERE id = ?', [JSON.stringify(merged), id]);

  enqueueChange('boxes', id, 'UPDATE', changedFields);

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
  },
): Item {
  const db = getDb();
  const id = genId();
  const now = nowIso();

  db.runSync(
    `INSERT INTO items (id, box_id, name, quantity, unit, expiry_date, barcode, image_url, category, notes, opened, damaged, pack_count, last_verified, added_by, created_at, updated_at, _synced, _local_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 0, ?)`,
    [
      id, boxId, input.name, input.quantity, input.unit,
      input.expiry_date ?? null, input.barcode ?? null, input.image_url ?? null,
      input.category ?? null, input.notes ?? null,
      input.opened ? 1 : 0, input.damaged ? 1 : 0,
      input.pack_count ?? null, addedBy, now, now, now,
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
  };
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
  const fields: string[] = [];
  const values: any[] = [];

  for (const [key, val] of Object.entries(patch)) {
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

  db.runSync(`UPDATE items SET ${fields.join(', ')} WHERE id = ?`, values);

  // Track changed fields
  const changedFields = Object.keys(patch);
  const existing = db.getFirstSync<{ _changed_fields: string | null; box_id: string }>(
    'SELECT _changed_fields, box_id FROM items WHERE id = ?', [id],
  );
  const prev = existing?._changed_fields ? JSON.parse(existing._changed_fields) : [];
  const merged = [...new Set([...prev, ...changedFields])];
  db.runSync('UPDATE items SET _changed_fields = ? WHERE id = ?', [JSON.stringify(merged), id]);

  if (existing?.box_id) recalcBoxCacheLocal(existing.box_id);
  enqueueChange('items', id, 'UPDATE', changedFields);

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
    db.runSync('UPDATE items SET quantity = ?, updated_at = ?, _synced = 0, _local_updated_at = ? WHERE id = ?',
      [(match?.quantity ?? 0) + moveQty, now, now, matchId]);
    enqueueChange('items', matchId, 'UPDATE', ['quantity']);

    if (movingAll) {
      db.runSync('UPDATE items SET _deleted_at = ?, _synced = 0, _local_updated_at = ? WHERE id = ?', [now, now, itemId]);
      enqueueChange('items', itemId, 'DELETE');
    } else {
      db.runSync('UPDATE items SET quantity = ?, updated_at = ?, _synced = 0, _local_updated_at = ? WHERE id = ?',
        [src.quantity - moveQty, now, now, itemId]);
      enqueueChange('items', itemId, 'UPDATE', ['quantity']);
    }
  } else {
    if (movingAll) {
      db.runSync('UPDATE items SET box_id = ?, updated_at = ?, _synced = 0, _local_updated_at = ? WHERE id = ?',
        [targetBoxId, now, now, itemId]);
      enqueueChange('items', itemId, 'UPDATE', ['box_id']);
    } else {
      db.runSync('UPDATE items SET quantity = ?, updated_at = ?, _synced = 0, _local_updated_at = ? WHERE id = ?',
        [src.quantity - moveQty, now, now, itemId]);
      enqueueChange('items', itemId, 'UPDATE', ['quantity']);

      const newId = genId();
      db.runSync(
        `INSERT INTO items (id, box_id, name, quantity, unit, expiry_date, barcode, image_url, category, notes, opened, damaged, pack_count, last_verified, added_by, created_at, updated_at, _synced, _local_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [newId, targetBoxId, src.name, moveQty, src.unit, src.expiry_date, src.barcode, src.image_url, src.category, src.notes, src.opened, src.damaged, src.pack_count, src.last_verified, addedBy, now, now, now],
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
    enqueueChange('items', itemId, 'UPDATE', ['quantity']);
  }

  let resultId: string;
  if (matchId) {
    const match = db.getFirstSync<any>('SELECT quantity FROM items WHERE id = ?', [matchId]);
    db.runSync('UPDATE items SET quantity = ?, updated_at = ?, _synced = 0, _local_updated_at = ? WHERE id = ?',
      [(match?.quantity ?? 0) + 1, now, now, matchId]);
    enqueueChange('items', matchId, 'UPDATE', ['quantity']);
    resultId = matchId;
  } else {
    resultId = genId();
    db.runSync(
      `INSERT INTO items (id, box_id, name, quantity, unit, expiry_date, barcode, image_url, category, notes, opened, damaged, pack_count, last_verified, added_by, created_at, updated_at, _synced, _local_updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [resultId, src.box_id, src.name, src.unit, src.expiry_date, src.barcode, src.image_url, src.category, src.notes, src.damaged, src.pack_count, src.last_verified, addedBy, now, now, now],
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
    enqueueChange('items', itemId, 'UPDATE', ['opened', 'damaged', 'notes']);
    return;
  }

  // Split: decrement source, create conditioned copy
  db.runSync('UPDATE items SET quantity = ?, updated_at = ?, _synced = 0, _local_updated_at = ? WHERE id = ?',
    [src.quantity - 1, now, now, itemId]);
  enqueueChange('items', itemId, 'UPDATE', ['quantity']);

  const newId = genId();
  db.runSync(
    `INSERT INTO items (id, box_id, name, quantity, unit, expiry_date, barcode, image_url, category, notes, opened, damaged, pack_count, last_verified, added_by, created_at, updated_at, _synced, _local_updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [newId, src.box_id, src.name, src.unit, src.expiry_date, src.barcode, src.image_url, src.category, conditions.notes, conditions.opened ? 1 : 0, conditions.damaged ? 1 : 0, src.pack_count, src.last_verified, addedBy, now, now, now],
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

  return { id, owner_id: ownerId, name, created_at: now };
}

export function renameWarehouseLocal(id: string, name: string): Warehouse {
  const db = getDb();
  const now = nowIso();

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

  enqueueChange('warehouses', id, 'UPDATE', ['name']);

  return db.getFirstSync<Warehouse>(
    'SELECT id, owner_id, name, created_at FROM warehouses WHERE id = ?', [id],
  )!;
}

// ---- Verify items ---------------------------------------------------------

export function verifyItemsLocal(itemIds: string[]): void {
  if (itemIds.length === 0) return;
  const db = getDb();
  const now = nowIso();
  for (const id of itemIds) {
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
    enqueueChange('items', id, 'UPDATE', ['last_verified']);
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
  db.runSync(
    `UPDATE inventory_sessions SET completed_at = ?, found_count = ?, missing_count = ? WHERE id = ?`,
    [now, foundCount, missingCount, sessionId],
  );
  enqueueChange('inventory_sessions', sessionId, 'UPDATE', ['completed_at', 'found_count', 'missing_count']);

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
}): CustomProduct {
  const db = getDb();
  const now = nowIso();

  // Check if exists
  const existing = db.getFirstSync<{ id: string }>(
    'SELECT id FROM custom_products WHERE warehouse_id = ? AND barcode = ? AND _deleted_at IS NULL',
    [input.warehouse_id, input.barcode],
  );

  if (existing) {
    db.runSync(
      `UPDATE custom_products SET name = ?, category = ?, image_url = ?, typical_expiry_days = ?, _synced = 0 WHERE id = ?`,
      [input.name, input.category ?? null, input.image_url ?? null, input.typical_expiry_days ?? null, existing.id],
    );
    enqueueChange('custom_products', existing.id, 'UPDATE', ['name', 'category', 'image_url', 'typical_expiry_days']);
    return db.getFirstSync<CustomProduct>(
      'SELECT id, warehouse_id, barcode, name, category, image_url, typical_expiry_days, created_by, created_at FROM custom_products WHERE id = ?',
      [existing.id],
    )!;
  }

  const id = genId();
  db.runSync(
    `INSERT INTO custom_products (id, warehouse_id, barcode, name, category, image_url, typical_expiry_days, created_by, created_at, _synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [id, input.warehouse_id, input.barcode, input.name, input.category ?? null, input.image_url ?? null, input.typical_expiry_days ?? null, input.created_by, now],
  );
  enqueueChange('custom_products', id, 'INSERT');

  return {
    id, warehouse_id: input.warehouse_id, barcode: input.barcode, name: input.name,
    category: (input.category ?? null) as Category | null, image_url: input.image_url ?? null,
    typical_expiry_days: input.typical_expiry_days ?? null, created_by: input.created_by, created_at: now,
  };
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
