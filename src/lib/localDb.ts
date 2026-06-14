// ============================================================================
// Kalta – Local SQLite database
// Offline-first data layer. Every table mirrors its Supabase counterpart
// plus sync metadata columns (_synced, _changed_fields, _deleted_at,
// _local_updated_at). Reads always go to SQLite. Writes go to SQLite
// first, then a background sync job flushes to Supabase when online.
//
// Sync strategy:
// - Each row has `_synced` (boolean) — false when locally modified and
//   not yet pushed to server.
// - `_changed_fields` (JSON string) — set of field names modified locally
//   since last sync. Enables per-field merge on conflict.
// - `_deleted_at` (ISO string | null) — soft delete. Rows with this set
//   are invisible to queries but retained for sync (server needs to know
//   about deletions).
// - `_local_updated_at` (ISO string) — local timestamp of last write.
//   Compared against server's `updated_at` to detect conflicts.
// ============================================================================
import * as SQLite from 'expo-sqlite';

const DB_NAME = 'kalta.db';
const DB_VERSION = 1;

let _db: SQLite.SQLiteDatabase | null = null;

/**
 * Get or create the singleton database connection. Safe to call multiple
 * times — returns the same instance.
 */
export function getDb(): SQLite.SQLiteDatabase {
  if (!_db) {
    _db = SQLite.openDatabaseSync(DB_NAME);
    _db.execSync('PRAGMA journal_mode = WAL;');
    _db.execSync('PRAGMA foreign_keys = ON;');
  }
  return _db;
}

/**
 * Initialize all tables. Idempotent — uses IF NOT EXISTS. Called once
 * on app start before any reads/writes.
 */
export function initLocalDb(): void {
  const db = getDb();

  db.execSync(`
    -- Sync metadata table: tracks last successful sync timestamp per table
    CREATE TABLE IF NOT EXISTS _sync_meta (
      table_name TEXT PRIMARY KEY,
      last_pulled_at TEXT,
      last_pushed_at TEXT
    );

    -- Users (minimal — just for display_name/email lookup)
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT,
      display_name TEXT,
      avatar_url TEXT,
      created_at TEXT NOT NULL,
      _synced INTEGER NOT NULL DEFAULT 1,
      _deleted_at TEXT
    );

    -- Warehouses
    CREATE TABLE IF NOT EXISTS warehouses (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      _synced INTEGER NOT NULL DEFAULT 1,
      _changed_fields TEXT,
      _deleted_at TEXT,
      _local_updated_at TEXT
    );

    -- Warehouse members
    CREATE TABLE IF NOT EXISTS warehouse_members (
      warehouse_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      _synced INTEGER NOT NULL DEFAULT 1,
      _deleted_at TEXT,
      PRIMARY KEY (warehouse_id, user_id)
    );

    -- Boxes
    CREATE TABLE IF NOT EXISTS boxes (
      id TEXT PRIMARY KEY,
      warehouse_id TEXT NOT NULL,
      name TEXT NOT NULL,
      location TEXT,
      qr_code TEXT NOT NULL UNIQUE,
      nearest_expiry TEXT,
      item_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      _synced INTEGER NOT NULL DEFAULT 1,
      _changed_fields TEXT,
      _deleted_at TEXT,
      _local_updated_at TEXT
    );

    -- Items
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      box_id TEXT NOT NULL,
      name TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 1,
      unit TEXT NOT NULL DEFAULT 'pcs',
      expiry_date TEXT,
      barcode TEXT,
      image_url TEXT,
      category TEXT,
      notes TEXT,
      opened INTEGER NOT NULL DEFAULT 0,
      damaged INTEGER NOT NULL DEFAULT 0,
      pack_count INTEGER,
      last_verified TEXT,
      added_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      _synced INTEGER NOT NULL DEFAULT 1,
      _changed_fields TEXT,
      _deleted_at TEXT,
      _local_updated_at TEXT
    );

    -- Custom products
    CREATE TABLE IF NOT EXISTS custom_products (
      id TEXT PRIMARY KEY,
      warehouse_id TEXT NOT NULL,
      barcode TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      image_url TEXT,
      typical_expiry_days INTEGER,
      created_by TEXT,
      created_at TEXT NOT NULL,
      _synced INTEGER NOT NULL DEFAULT 1,
      _deleted_at TEXT,
      UNIQUE (warehouse_id, barcode)
    );

    -- Household members (Sprint 6 readiness)
    CREATE TABLE IF NOT EXISTS household_members (
      id TEXT PRIMARY KEY,
      warehouse_id TEXT NOT NULL,
      name TEXT NOT NULL,
      daily_kcal INTEGER NOT NULL DEFAULT 2000,
      daily_water_l REAL NOT NULL DEFAULT 3,
      kind TEXT,
      created_at TEXT NOT NULL,
      _synced INTEGER NOT NULL DEFAULT 1,
      _changed_fields TEXT,
      _deleted_at TEXT,
      _local_updated_at TEXT
    );

    -- Shopping list items (Sprint 6 readiness)
    CREATE TABLE IF NOT EXISTS shopping_list_items (
      id TEXT PRIMARY KEY,
      warehouse_id TEXT NOT NULL,
      label TEXT NOT NULL,
      category TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      source_ref TEXT,
      quantity REAL,
      checked INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      created_at TEXT NOT NULL,
      _synced INTEGER NOT NULL DEFAULT 1,
      _changed_fields TEXT,
      _deleted_at TEXT,
      _local_updated_at TEXT
    );

    -- Custom readiness checklists (Sprint 7). LWW sync like custom_products
    -- (just _synced / _deleted_at — small, low-conflict tables).
    CREATE TABLE IF NOT EXISTS checklists (
      id TEXT PRIMARY KEY,
      warehouse_id TEXT NOT NULL,
      name TEXT NOT NULL,
      is_seed INTEGER NOT NULL DEFAULT 0,
      goal_days INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      _synced INTEGER NOT NULL DEFAULT 1,
      _deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS checklist_entries (
      id TEXT PRIMARY KEY,
      checklist_id TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      seed_key TEXT,
      label TEXT NOT NULL,
      group_name TEXT,
      category TEXT,
      keywords TEXT,
      quantified TEXT,
      rationale TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      _synced INTEGER NOT NULL DEFAULT 1,
      _deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS checklist_satisfactions (
      id TEXT PRIMARY KEY,
      checklist_entry_id TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      item_id TEXT,
      mode TEXT NOT NULL,
      created_at TEXT NOT NULL,
      _synced INTEGER NOT NULL DEFAULT 1,
      _deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS warehouse_checklists (
      id TEXT PRIMARY KEY,
      warehouse_id TEXT NOT NULL,
      checklist_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      _synced INTEGER NOT NULL DEFAULT 1,
      _deleted_at TEXT
    );

    -- Invitations
    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      warehouse_id TEXT NOT NULL,
      invited_by TEXT NOT NULL,
      email TEXT,
      token TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'member',
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      created_at TEXT NOT NULL,
      _synced INTEGER NOT NULL DEFAULT 1,
      _deleted_at TEXT
    );

    -- Inventory sessions
    CREATE TABLE IF NOT EXISTS inventory_sessions (
      id TEXT PRIMARY KEY,
      box_id TEXT NOT NULL,
      performed_by TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      found_count INTEGER NOT NULL DEFAULT 0,
      missing_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL,
      _synced INTEGER NOT NULL DEFAULT 1,
      _deleted_at TEXT
    );

    -- Inventory lines
    CREATE TABLE IF NOT EXISTS inventory_lines (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      item_id TEXT,
      item_name TEXT NOT NULL,
      item_quantity REAL NOT NULL,
      item_unit TEXT NOT NULL,
      found_quantity REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      scanned_barcode TEXT,
      created_at TEXT NOT NULL,
      _synced INTEGER NOT NULL DEFAULT 1
    );

    -- Sync queue: tracks individual mutations for ordered push to server
    CREATE TABLE IF NOT EXISTS _sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      operation TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
      changed_fields TEXT,
      payload TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      pushed_at TEXT
    );

    -- Sync conflicts: stores server vs local snapshots when both sides
    -- modified the same row. User resolves per-field in the conflicts UI.
    CREATE TABLE IF NOT EXISTS _conflicts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      local_data TEXT NOT NULL,
      server_data TEXT NOT NULL,
      conflicting_fields TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_items_box ON items(box_id);
    CREATE INDEX IF NOT EXISTS idx_items_expiry ON items(expiry_date);
    CREATE INDEX IF NOT EXISTS idx_boxes_warehouse ON boxes(warehouse_id);
    CREATE INDEX IF NOT EXISTS idx_household_members_warehouse ON household_members(warehouse_id);
    CREATE INDEX IF NOT EXISTS idx_shopping_list_warehouse ON shopping_list_items(warehouse_id);
    CREATE INDEX IF NOT EXISTS idx_checklists_warehouse ON checklists(warehouse_id);
    CREATE INDEX IF NOT EXISTS idx_checklist_entries_checklist ON checklist_entries(checklist_id);
    CREATE INDEX IF NOT EXISTS idx_checklist_entries_warehouse ON checklist_entries(warehouse_id);
    CREATE INDEX IF NOT EXISTS idx_checklist_sat_warehouse ON checklist_satisfactions(warehouse_id);
    CREATE INDEX IF NOT EXISTS idx_warehouse_checklists_warehouse ON warehouse_checklists(warehouse_id);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_pending ON _sync_queue(pushed_at) WHERE pushed_at IS NULL;
  `);

  // Column migrations for existing installs (CREATE TABLE IF NOT EXISTS
  // above won't add columns to a table that already exists). Sprint 6
  // readiness adds nutrition + par-level + goal columns.
  addColumnIfMissing(db, 'warehouses', 'readiness_goal_days', 'INTEGER NOT NULL DEFAULT 14');
  addColumnIfMissing(db, 'items', 'energy_kcal_per_100g', 'REAL');
  addColumnIfMissing(db, 'items', 'net_weight_g', 'REAL');
  addColumnIfMissing(db, 'items', 'min_quantity', 'REAL');
  addColumnIfMissing(db, 'custom_products', 'min_quantity', 'REAL');
  addColumnIfMissing(db, 'custom_products', 'energy_kcal_per_100g', 'REAL');
  addColumnIfMissing(db, 'custom_products', 'net_weight_g', 'REAL');
  addColumnIfMissing(db, 'household_members', 'kind', 'TEXT');
  addColumnIfMissing(db, 'shopping_list_items', 'reason', 'TEXT');
}

/**
 * Idempotently add a column to a SQLite table. Checks PRAGMA table_info
 * first so re-running on an already-migrated DB is a no-op (ALTER TABLE
 * ADD COLUMN throws on duplicate in SQLite).
 */
function addColumnIfMissing(
  db: ReturnType<typeof getDb>,
  table: string,
  column: string,
  definition: string,
): void {
  const cols = db.getAllSync<{ name: string }>(`PRAGMA table_info(${table});`);
  if (cols.some((c) => c.name === column)) return;
  db.execSync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
}

/**
 * Get the DB version for migration tracking. Returns 0 if fresh install.
 */
export function getDbVersion(): number {
  const db = getDb();
  const result = db.getFirstSync<{ user_version: number }>('PRAGMA user_version;');
  return result?.user_version ?? 0;
}

export function setDbVersion(version: number): void {
  const db = getDb();
  db.execSync(`PRAGMA user_version = ${version};`);
}
