// ============================================================================
// Kalta – P2P sync data exchange
// Serializes local SQLite data into a JSON bundle for sending to another
// device via MultipeerConnectivity. Receives and merges incoming bundles.
//
// Strategy: "last-write-wins" per row based on updated_at / created_at.
// For a 2-person family this is sufficient — true conflicts are rare.
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
 * Uses last-write-wins for conflicts based on updated_at/created_at.
 * Returns stats about what was merged.
 */
export function importSyncBundle(jsonString: string): {
  inserted: number;
  updated: number;
  skipped: number;
} {
  const bundle: SyncBundle = JSON.parse(jsonString);
  if (bundle.version !== 1) throw new Error(`Unknown sync bundle version: ${bundle.version}`);

  const db = getDb();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  db.execSync('BEGIN TRANSACTION;');
  try {
    // Warehouses
    for (const row of bundle.warehouses) {
      const result = mergeRow(db, 'warehouses', row, 'created_at');
      if (result === 'inserted') inserted++;
      else if (result === 'updated') updated++;
      else skipped++;
    }

    // Warehouse members (composite PK)
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
        inserted++;
      } else {
        skipped++;
      }
    }

    // Boxes
    for (const row of bundle.boxes) {
      const result = mergeRow(db, 'boxes', row, 'updated_at');
      if (result === 'inserted') inserted++;
      else if (result === 'updated') updated++;
      else skipped++;
    }

    // Items
    const affectedBoxIds = new Set<string>();
    for (const row of bundle.items) {
      const result = mergeRow(db, 'items', row, 'updated_at');
      if (result !== 'skipped') affectedBoxIds.add(row.box_id);
      if (result === 'inserted') inserted++;
      else if (result === 'updated') updated++;
      else skipped++;
    }

    // Custom products
    for (const row of bundle.custom_products) {
      const result = mergeRow(db, 'custom_products', row, 'created_at');
      if (result === 'inserted') inserted++;
      else if (result === 'updated') updated++;
      else skipped++;
    }

    // Inventory sessions
    for (const row of bundle.inventory_sessions) {
      const result = mergeRow(db, 'inventory_sessions', row, 'created_at');
      if (result === 'inserted') inserted++;
      else if (result === 'updated') updated++;
      else skipped++;
    }

    // Inventory lines
    for (const row of bundle.inventory_lines) {
      const result = mergeRow(db, 'inventory_lines', row, 'created_at');
      if (result === 'inserted') inserted++;
      else if (result === 'updated') updated++;
      else skipped++;
    }

    // Recalculate box caches for affected boxes
    for (const boxId of affectedBoxIds) {
      recalcBoxCacheLocal(boxId);
    }

    db.execSync('COMMIT;');
  } catch (e) {
    db.execSync('ROLLBACK;');
    throw e;
  }

  return { inserted, updated, skipped };
}

/**
 * Merge a single row into a table. Uses last-write-wins based on the
 * specified timestamp field.
 */
function mergeRow(
  db: any,
  table: string,
  row: any,
  tsField: string,
): 'inserted' | 'updated' | 'skipped' {
  const local = db.getFirstSync(
    `SELECT * FROM ${table} WHERE id = ?`,
    [row.id],
  ) as any;

  if (!local) {
    // Row doesn't exist locally — insert it
    const cols = Object.keys(row).filter((k) => !k.startsWith('_'));
    const syncCols = ['_synced'];
    const allCols = [...cols, ...syncCols];
    const placeholders = allCols.map(() => '?').join(', ');
    const values = cols.map((c) => {
      // Convert booleans to integers for SQLite
      if (c === 'opened' || c === 'damaged') return row[c] ? 1 : 0;
      return row[c] ?? null;
    });
    values.push(1); // _synced = 1 (came from another device, already "synced")

    db.runSync(
      `INSERT OR IGNORE INTO ${table} (${allCols.join(', ')}) VALUES (${placeholders})`,
      values,
    );
    return 'inserted';
  }

  // Row exists — compare timestamps
  const localTs = local[tsField] ?? local.created_at ?? '';
  const remoteTs = row[tsField] ?? row.created_at ?? '';

  if (remoteTs > localTs) {
    // Remote is newer — update local
    const cols = Object.keys(row).filter((k) => !k.startsWith('_'));
    const updates = cols.map((c) => `${c} = ?`).join(', ');
    const values = cols.map((c) => {
      if (c === 'opened' || c === 'damaged') return row[c] ? 1 : 0;
      return row[c] ?? null;
    });
    values.push(row.id);

    db.runSync(
      `UPDATE ${table} SET ${updates}, _synced = 1 WHERE id = ?`,
      values,
    );
    return 'updated';
  }

  return 'skipped';
}
