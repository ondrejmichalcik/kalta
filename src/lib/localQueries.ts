// ============================================================================
// Kalta – Local SQLite read queries
// Mirror of the Supabase read functions but hitting local SQLite instead
// of the network. Every function returns the same types as the Supabase
// originals so the UI layer doesn't need any changes.
// ============================================================================
import { getDb } from './localDb';
import type {
  Box,
  CustomProduct,
  InventoryLine,
  InventorySession,
  Item,
  ItemWithBox,
  Role,
  Warehouse,
  WarehouseMember,
  WarehouseWithRole,
} from '@/src/types/database';

// ---- Warehouses -----------------------------------------------------------

export function getMyWarehousesLocal(userId: string): WarehouseWithRole[] {
  const db = getDb();
  const rows = db.getAllSync<any>(
    `SELECT w.*, wm.role as my_role
     FROM warehouse_members wm
     JOIN warehouses w ON w.id = wm.warehouse_id
     WHERE wm.user_id = ? AND wm._deleted_at IS NULL AND w._deleted_at IS NULL
     ORDER BY wm.joined_at ASC`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    owner_id: r.owner_id,
    name: r.name,
    created_at: r.created_at,
    my_role: r.my_role as Role,
  }));
}

export function getWarehouseByIdLocal(id: string): Warehouse | null {
  const db = getDb();
  const row = db.getFirstSync<any>(
    `SELECT * FROM warehouses WHERE id = ? AND _deleted_at IS NULL`,
    [id],
  );
  if (!row) return null;
  return { id: row.id, owner_id: row.owner_id, name: row.name, created_at: row.created_at };
}

// ---- Members --------------------------------------------------------------

export function listMembersLocal(
  warehouseId: string,
): (WarehouseMember & { user: { display_name: string | null; email: string | null } })[] {
  const db = getDb();
  const rows = db.getAllSync<any>(
    `SELECT wm.*, u.display_name, u.email
     FROM warehouse_members wm
     LEFT JOIN users u ON u.id = wm.user_id
     WHERE wm.warehouse_id = ? AND wm._deleted_at IS NULL
     ORDER BY wm.joined_at ASC`,
    [warehouseId],
  );
  return rows.map((r) => ({
    warehouse_id: r.warehouse_id,
    user_id: r.user_id,
    role: r.role as Role,
    joined_at: r.joined_at,
    user: { display_name: r.display_name, email: r.email },
  }));
}

// ---- Boxes ----------------------------------------------------------------

export function listBoxesLocal(warehouseId: string): Box[] {
  const db = getDb();
  return db.getAllSync<Box>(
    `SELECT id, warehouse_id, name, location, qr_code, nearest_expiry,
            item_count, created_at, updated_at
     FROM boxes
     WHERE warehouse_id = ? AND _deleted_at IS NULL`,
    [warehouseId],
  );
}

export function getBoxByIdLocal(id: string): Box | null {
  const db = getDb();
  return db.getFirstSync<Box>(
    `SELECT id, warehouse_id, name, location, qr_code, nearest_expiry,
            item_count, created_at, updated_at
     FROM boxes WHERE id = ? AND _deleted_at IS NULL`,
    [id],
  );
}

export function getBoxByQrLocal(qrCode: string): Box | null {
  const db = getDb();
  return db.getFirstSync<Box>(
    `SELECT id, warehouse_id, name, location, qr_code, nearest_expiry,
            item_count, created_at, updated_at
     FROM boxes WHERE qr_code = ? AND _deleted_at IS NULL`,
    [qrCode],
  );
}

// ---- Items ----------------------------------------------------------------

function mapItem(r: any): Item {
  return {
    ...r,
    opened: !!r.opened,
    damaged: !!r.damaged,
  };
}

export function listItemsLocal(boxId: string): Item[] {
  const db = getDb();
  const rows = db.getAllSync<any>(
    `SELECT * FROM items
     WHERE box_id = ? AND _deleted_at IS NULL
     ORDER BY expiry_date ASC NULLS LAST`,
    [boxId],
  );
  return rows.map(mapItem);
}

export function listAllItemsInWarehouseLocal(warehouseId: string): ItemWithBox[] {
  const db = getDb();
  const rows = db.getAllSync<any>(
    `SELECT i.*, b.name as box_name
     FROM items i
     JOIN boxes b ON b.id = i.box_id
     WHERE b.warehouse_id = ? AND i._deleted_at IS NULL AND b._deleted_at IS NULL
     ORDER BY i.expiry_date ASC NULLS LAST`,
    [warehouseId],
  );
  return rows.map((r) => ({ ...mapItem(r), box_name: r.box_name ?? '' }));
}

// ---- Custom products ------------------------------------------------------

export function findCustomProductLocal(
  warehouseId: string,
  barcode: string,
): CustomProduct | null {
  const db = getDb();
  return db.getFirstSync<CustomProduct>(
    `SELECT * FROM custom_products
     WHERE warehouse_id = ? AND barcode = ? AND _deleted_at IS NULL`,
    [warehouseId, barcode],
  );
}

export function listCustomProductsLocal(warehouseId: string): CustomProduct[] {
  const db = getDb();
  return db.getAllSync<CustomProduct>(
    `SELECT * FROM custom_products
     WHERE warehouse_id = ? AND _deleted_at IS NULL
     ORDER BY name ASC`,
    [warehouseId],
  );
}

// ---- Inventory ------------------------------------------------------------

export function listInventorySessionsLocal(
  boxId: string,
): (InventorySession & { user: { display_name: string | null; email: string | null } })[] {
  const db = getDb();
  const rows = db.getAllSync<any>(
    `SELECT s.*, u.display_name, u.email
     FROM inventory_sessions s
     LEFT JOIN users u ON u.id = s.performed_by
     WHERE s.box_id = ? AND s.completed_at IS NOT NULL AND s._deleted_at IS NULL
     ORDER BY s.completed_at DESC`,
    [boxId],
  );
  return rows.map((r) => ({
    id: r.id,
    box_id: r.box_id,
    performed_by: r.performed_by,
    started_at: r.started_at,
    completed_at: r.completed_at,
    found_count: r.found_count,
    missing_count: r.missing_count,
    notes: r.notes,
    created_at: r.created_at,
    user: { display_name: r.display_name, email: r.email },
  }));
}

export function getInventoryLinesLocal(sessionId: string): InventoryLine[] {
  const db = getDb();
  return db.getAllSync<InventoryLine>(
    `SELECT * FROM inventory_lines
     WHERE session_id = ?
     ORDER BY status ASC`,
    [sessionId],
  );
}
