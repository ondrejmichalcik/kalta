// ============================================================================
// Kalta – Supabase client + API
// ============================================================================
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import type {
  Box,
  CustomProduct,
  Invitation,
  InventoryLine,
  InventoryLineStatus,
  InventorySession,
  Item,
  ItemWithBox,
  Role,
  Unit,
  Warehouse,
  WarehouseMember,
  WarehouseWithRole,
  Category,
  HouseholdMember,
  MemberKind,
  ShoppingListItem,
  ShoppingSource,
  Checklist,
  ChecklistEntry,
  ChecklistSatisfaction,
  SatisfactionMode,
  WarehouseChecklist,
} from '@/src/types/database';

import { hasInitialSync } from './sync';
import { wasRecentLocalWrite } from './realtimeEcho';
import {
  addItemLocal,
  addItemsBatchLocal,
  createBoxLocal,
  deleteBoxLocal,
  deleteItemLocal,
  markItemConditionLocal,
  moveItemQuantityLocal,
  openOneItemLocal,
  updateBoxLocal,
  updateItemLocal,
  createWarehouseLocal,
  renameWarehouseLocal,
  verifyItemsLocal,
  createInventorySessionLocal,
  completeInventorySessionLocal,
  upsertCustomProductLocal,
  deleteCustomProductLocal,
  setCustomProductMinQuantityLocal,
  addHouseholdMemberLocal,
  updateHouseholdMemberLocal,
  deleteHouseholdMemberLocal,
  setReadinessGoalLocal,
  addShoppingItemLocal,
  setShoppingItemCheckedLocal,
  deleteShoppingItemLocal,
  createChecklistLocal,
  updateChecklistLocal,
  deleteChecklistLocal,
  createChecklistEntryLocal,
  updateChecklistEntryLocal,
  deleteChecklistEntryLocal,
  setChecklistSatisfactionLocal,
  addWarehouseChecklistLocal,
  removeWarehouseChecklistLocal,
} from './localWrites';
import {
  findCustomProductLocal,
  getBoxByIdLocal,
  getBoxByQrLocal,
  getMyWarehousesLocal,
  getWarehouseByIdLocal,
  listAllItemsInWarehouseLocal,
  listBoxesLocal,
  listCustomProductsLocal,
  listHouseholdMembersLocal,
  listShoppingListLocal,
  listChecklistsLocal,
  listChecklistEntriesLocal,
  listChecklistSatisfactionsLocal,
  listWarehouseChecklistsLocal,
  listItemsLocal,
  listMembersLocal,
  listInventorySessionsLocal,
  getInventoryLinesLocal,
} from './localQueries';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
// New publishable key (sb_publishable_...), replaces the legacy anon key
const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    '[kalta] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY – nastav je v .env',
  );
}

export const supabase = createClient(SUPABASE_URL ?? '', SUPABASE_PUBLISHABLE_KEY ?? '', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// ============================================================================
// AUTH
// ============================================================================

export async function signInWithApple(identityToken: string, nonce?: string) {
  return supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: identityToken,
    nonce,
  });
}

// Set to true right before calling supabase.auth.signOut() so the
// `SIGNED_OUT` auth-state handler in _layout.tsx can distinguish an
// explicit user-initiated sign out from an involuntary one (e.g.
// Supabase failing to refresh an expired token while the device is
// offline — it also emits SIGNED_OUT but we must keep the cached
// identity so the app keeps working locally).
let _explicitSignOut = false;

export function consumeExplicitSignOut(): boolean {
  const v = _explicitSignOut;
  _explicitSignOut = false;
  return v;
}

export async function signOut() {
  _explicitSignOut = true;
  // Clear our own cached identity FIRST and notify the auth bridge so
  // the auth guard in _layout.tsx flips to "not authenticated" and
  // navigates to /login immediately. We don't want to rely on the
  // supabase SIGNED_OUT event firing — its auth state machine can wedge
  // (the same root cause that made auth.getSession() hang on cold start
  // before commit c180dca), and if it never emits SIGNED_OUT the user
  // would tap "Sign out" with nothing visible happening.
  try {
    await AsyncStorage.removeItem('kalta:cachedUser');
  } catch { /* non-fatal — the auth bridge nudge below still flips state */ }
  // Lazy require to avoid pulling authBridge into the import graph at
  // module-load time (this file is imported very early).
  const { emitCachedUserChanged } = require('./authBridge') as typeof import('./authBridge');
  emitCachedUserChanged(null);
  // Best-effort supabase cleanup — fire-and-forget so we don't await a
  // potentially-stuck internal call. `scope: 'local'` skips the network
  // revoke; supabase still clears its own AsyncStorage keys.
  supabase.auth.signOut({ scope: 'local' }).catch(() => {});
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/**
 * Returns the effective user id for the current app instance. Prefers
 * the live Supabase session; falls back to the cached identity written
 * by the login flow (sign-in or "Continue offline"). Screens that filter
 * data by user must use this — calling `supabase.auth.getSession()`
 * directly returns null when the user continued offline, which makes
 * every list look empty.
 */
export async function getActiveUserId(): Promise<string | null> {
  // Prefer the cached identity. `supabase.auth.getSession()` can hang for
  // minutes when its internal token-refresh state machine wedges (e.g.
  // expired refresh token + a slow auth server, or a stuck retry loop).
  // The cache is written/cleared by the auth state listener in
  // _layout.tsx, so it's always in sync with the live session when one
  // exists — and works as the only source of truth when the user is
  // in "Continue offline" mode.
  try {
    const raw = await AsyncStorage.getItem('kalta:cachedUser');
    if (raw) {
      const parsed = JSON.parse(raw) as { id?: string };
      if (parsed?.id) return parsed.id;
    }
  } catch { /* fall through to live session */ }
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

/**
 * Returns both the active user id AND the best-known email. Email is null
 * in offline continue mode (we don't cache it). Use this for Profile-style
 * identity rendering.
 */
export async function getActiveUser(): Promise<{ id: string; email: string | null } | null> {
  try {
    const raw = await AsyncStorage.getItem('kalta:cachedUser');
    if (raw) {
      const parsed = JSON.parse(raw) as { id?: string; email?: string | null };
      if (parsed?.id) return { id: parsed.id, email: parsed.email ?? null };
    }
  } catch { /* fall through to live session */ }
  const { data } = await supabase.auth.getSession();
  if (data.session?.user) {
    return { id: data.session.user.id, email: data.session.user.email ?? null };
  }
  return null;
}

// ============================================================================
// WAREHOUSES
// ============================================================================

/**
 * Full list of warehouses the user belongs to, annotated with the user's role
 * per warehouse. Ordered by `joined_at asc` so the oldest (usually self-created)
 * sits first. Feeds the Warehouses list screen; realtime updates via
 * `subscribeMyWarehouses`.
 */
export async function getMyWarehouses(userId: string): Promise<WarehouseWithRole[]> {
  // SQLite-first: instant, offline-capable
  try {
    if (hasInitialSync()) return getMyWarehousesLocal(userId);
  } catch { /* fallback to Supabase */ }

  const { data, error } = await supabase
    .from('warehouse_members')
    .select('role, joined_at, warehouses(*)')
    .eq('user_id', userId)
    .order('joined_at', { ascending: true });
  if (error) throw error;
  if (!data) return [];
  return data
    .map((row: any) => {
      if (!row.warehouses) return null;
      return { ...(row.warehouses as Warehouse), my_role: row.role as Role };
    })
    .filter((w): w is WarehouseWithRole => w !== null);
}

/**
 * Create a new warehouse and add the creator as an owner. Uses the
 * SECURITY DEFINER RPC `create_warehouse_for_me`, which bypasses RLS and
 * does both inserts atomically. See schema.sql.
 *
 * `userId` is kept for API compatibility — the RPC uses auth.uid() internally.
 */
export async function createWarehouse(userId: string, name: string): Promise<Warehouse> {
  // createWarehouse uses an RPC that atomically creates warehouse +
  // membership + owner_id. Offline creation is tricky (composite PK
  // membership, RLS bootstrap) so we try server first, fall back to
  // local-only if offline.
  try {
    const { data, error } = await supabase.rpc('create_warehouse_for_me', { wh_name: name });
    if (error) throw error;
    if (!data) throw new Error('Warehouse was not created.');
    const wh = data as Warehouse;
    // Persist to SQLite so local reads work immediately
    if (hasInitialSync()) {
      const db = (await import('./localDb')).getDb();
      const now = new Date().toISOString();
      db.runSync(
        `INSERT OR REPLACE INTO warehouses (id, owner_id, name, created_at, _synced, _local_updated_at)
         VALUES (?, ?, ?, ?, 1, ?)`,
        [wh.id, wh.owner_id, wh.name, wh.created_at, now],
      );
      db.runSync(
        `INSERT OR REPLACE INTO warehouse_members (warehouse_id, user_id, role, joined_at, _synced)
         VALUES (?, ?, 'owner', ?, 1)`,
        [wh.id, userId, now],
      );
    }
    return wh;
  } catch (e: any) {
    // Offline fallback: create locally, will need manual sync later
    if (hasInitialSync()) {
      return createWarehouseLocal(userId, name);
    }
    throw e;
  }
}

export async function getWarehouseById(id: string): Promise<Warehouse | null> {
  try {
    if (hasInitialSync()) return getWarehouseByIdLocal(id);
  } catch { /* fallback */ }

  const { data, error } = await supabase
    .from('warehouses')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as Warehouse) ?? null;
}

export async function renameWarehouse(id: string, name: string): Promise<Warehouse> {
  if (hasInitialSync()) {
    const wh = renameWarehouseLocal(id, name);
    supabase.from('warehouses').update({ name }).eq('id', id).then(() => {}, () => {});
    return wh;
  }

  const { data, error } = await supabase
    .from('warehouses')
    .update({ name })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as Warehouse;
}

export async function deleteWarehouse(id: string): Promise<void> {
  const { error } = await supabase.from('warehouses').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Remove self from a warehouse. Fails with a descriptive error if the caller
 * is the last remaining owner — the DB trigger would block it too, but
 * checking up-front lets us show a helpful message instead of a raw SQL error.
 */
export async function leaveWarehouse(warehouseId: string, userId: string): Promise<void> {
  const { data: members, error: memErr } = await supabase
    .from('warehouse_members')
    .select('user_id, role')
    .eq('warehouse_id', warehouseId);
  if (memErr) throw memErr;
  const owners = (members ?? []).filter((m) => m.role === 'owner');
  if (owners.length === 1 && owners[0].user_id === userId) {
    throw new Error(
      'You are the last owner of this warehouse. Promote another member first, or delete the warehouse.',
    );
  }
  const { error } = await supabase
    .from('warehouse_members')
    .delete()
    .eq('warehouse_id', warehouseId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function listMembers(warehouseId: string): Promise<
  (WarehouseMember & { user: { display_name: string | null; email: string | null } })[]
> {
  try {
    if (hasInitialSync()) return listMembersLocal(warehouseId);
  } catch { /* fallback */ }

  const { data, error } = await supabase
    .from('warehouse_members')
    .select('*, user:users(display_name, email)')
    .eq('warehouse_id', warehouseId);
  if (error) throw error;
  return (data as any) ?? [];
}

export async function promoteMember(warehouseId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('warehouse_members')
    .update({ role: 'owner' })
    .eq('warehouse_id', warehouseId)
    .eq('user_id', userId);
  if (error) throw error;
}

/**
 * Demote a member from owner → member. Refuses to demote the last owner
 * (would leave the warehouse unmanageable).
 */
export async function demoteMember(warehouseId: string, userId: string): Promise<void> {
  const { data: members, error: memErr } = await supabase
    .from('warehouse_members')
    .select('user_id, role')
    .eq('warehouse_id', warehouseId);
  if (memErr) throw memErr;
  const owners = (members ?? []).filter((m) => m.role === 'owner');
  if (owners.length === 1 && owners[0].user_id === userId) {
    throw new Error(
      'Cannot demote the last owner. Promote another member first.',
    );
  }
  const { error } = await supabase
    .from('warehouse_members')
    .update({ role: 'member' })
    .eq('warehouse_id', warehouseId)
    .eq('user_id', userId);
  if (error) throw error;
}

/**
 * Owner kicks another user out of the warehouse. Refuses to remove the last
 * owner — the caller should delete the warehouse instead.
 */
export async function removeMember(warehouseId: string, userId: string): Promise<void> {
  const { data: members, error: memErr } = await supabase
    .from('warehouse_members')
    .select('user_id, role')
    .eq('warehouse_id', warehouseId);
  if (memErr) throw memErr;
  const owners = (members ?? []).filter((m) => m.role === 'owner');
  if (owners.length === 1 && owners[0].user_id === userId) {
    throw new Error(
      'Cannot remove the last owner. Promote another member first, or delete the warehouse.',
    );
  }
  const { error } = await supabase
    .from('warehouse_members')
    .delete()
    .eq('warehouse_id', warehouseId)
    .eq('user_id', userId);
  if (error) throw error;
}

// Realtime payloads expose `.new` and `.old` row snapshots. After our
// own optimistic write the server echoes the same row back; if our
// recent-write tracker still has the id, we suppress the callback.
function isOwnEcho(
  table: string,
  payload: { new?: Record<string, any>; old?: Record<string, any> },
): boolean {
  const id = payload?.new?.id ?? payload?.old?.id;
  if (!id) return false;
  return wasRecentLocalWrite(table, String(id));
}

/**
 * Realtime subscription on `warehouse_members` filtered by the current user.
 * Fires when the user is added to a new warehouse (accepted invitation),
 * removed from one, or has their role changed. Feeds the Warehouses list
 * screen so an invitation acceptance on another device reflects instantly.
 */
export function subscribeMyWarehouses(userId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`my-warehouses:${userId}:${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'warehouse_members',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        // warehouse_members has a composite PK so the row id used by
        // the echo tracker is the warehouse_id (mirrors how members
        // changes flow through enqueueChange / sync).
        const wid =
          (payload.new as any)?.warehouse_id ?? (payload.old as any)?.warehouse_id ?? null;
        if (wid && wasRecentLocalWrite('warehouse_members', wid)) return;
        onChange();
      },
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

// ============================================================================
// BOXES
// ============================================================================

export async function listBoxes(warehouseId: string): Promise<Box[]> {
  try {
    if (hasInitialSync()) return listBoxesLocal(warehouseId);
  } catch { /* fallback */ }

  const { data, error } = await supabase
    .from('boxes')
    .select('*')
    .eq('warehouse_id', warehouseId);
  if (error) throw error;
  return (data as Box[]) ?? [];
}

export async function getBoxById(id: string): Promise<Box | null> {
  try {
    if (hasInitialSync()) return getBoxByIdLocal(id);
  } catch { /* fallback */ }

  const { data, error } = await supabase.from('boxes').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as Box) ?? null;
}

export async function getBoxByQr(qrCode: string): Promise<Box | null> {
  try {
    if (hasInitialSync()) return getBoxByQrLocal(qrCode);
  } catch { /* fallback */ }

  const { data, error } = await supabase
    .from('boxes')
    .select('*')
    .eq('qr_code', qrCode)
    .maybeSingle();
  if (error) throw error;
  return (data as Box) ?? null;
}

export async function createBox(input: {
  warehouse_id: string;
  name: string;
  location?: string | null;
}): Promise<Box> {
  // SQLite-first: immediate local insert, background Supabase push.
  if (hasInitialSync()) {
    const box = createBoxLocal(input);
    // Fire-and-forget server push
    supabase.from('boxes').insert({
      id: box.id, warehouse_id: box.warehouse_id, name: box.name,
      location: box.location, qr_code: box.qr_code,
    }).then(() => {}, () => {});
    return box;
  }

  const { data, error } = await supabase
    .from('boxes')
    .insert({
      warehouse_id: input.warehouse_id,
      name: input.name,
      location: input.location ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Box;
}

export async function updateBox(id: string, patch: Partial<Pick<Box, 'name' | 'location'>>) {
  if (hasInitialSync()) {
    const box = updateBoxLocal(id, patch);
    supabase.from('boxes').update(patch).eq('id', id).then(() => {}, () => {});
    return box;
  }
  const { data, error } = await supabase.from('boxes').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data as Box;
}

export async function deleteBox(id: string) {
  if (hasInitialSync()) {
    deleteBoxLocal(id);
    supabase.from('boxes').delete().eq('id', id).then(() => {}, () => {});
    return;
  }
  const { error } = await supabase.from('boxes').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Realtime subscription to box changes in a warehouse. Returns a cleanup fn
 * to call in the useEffect return — it fully removes the channel from the
 * client (not just unsubscribe), otherwise a Strict Mode re-mount hits
 * "cannot add callbacks after subscribe".
 */
export function subscribeBoxes(warehouseId: string, onChange: () => void): () => void {
  const channel = supabase
    // Unique name per call — prevents cached channel re-use
    .channel(`boxes:${warehouseId}:${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'boxes',
        filter: `warehouse_id=eq.${warehouseId}`,
      },
      (payload) => {
        if (isOwnEcho('boxes', payload)) return;
        onChange();
      },
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Realtime subscription on the custom-checklist tables for a warehouse
 * (checklists / entries / satisfactions / warehouse links). Fires onChange
 * when a peer edits a list so the readiness + checklist screens live-update
 * instead of waiting for a focus-reload. Suppresses our own optimistic echoes.
 */
export function subscribeChecklists(warehouseId: string, onChange: () => void): () => void {
  const tables = [
    'checklists',
    'checklist_entries',
    'checklist_satisfactions',
    'warehouse_checklists',
  ] as const;
  let channel = supabase.channel(`checklists:${warehouseId}:${Math.random().toString(36).slice(2)}`);
  for (const table of tables) {
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `warehouse_id=eq.${warehouseId}` },
      (payload) => {
        if (isOwnEcho(table, payload)) return;
        onChange();
      },
    );
  }
  channel.subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

/** Realtime subscription on household_members for a warehouse — keeps the
 *  readiness days + household editor in sync when a peer edits members. */
export function subscribeHousehold(warehouseId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`household:${warehouseId}:${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'household_members', filter: `warehouse_id=eq.${warehouseId}` },
      (payload) => {
        if (isOwnEcho('household_members', payload)) return;
        onChange();
      },
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

/** Realtime subscription on shopping_list_items for a warehouse — the shared
 *  list updates live when a peer checks off / adds items in the store. */
export function subscribeShopping(warehouseId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`shopping:${warehouseId}:${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'shopping_list_items', filter: `warehouse_id=eq.${warehouseId}` },
      (payload) => {
        if (isOwnEcho('shopping_list_items', payload)) return;
        onChange();
      },
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

// ============================================================================
// ITEMS
// ============================================================================

export async function listItems(boxId: string): Promise<Item[]> {
  try {
    if (hasInitialSync()) return listItemsLocal(boxId);
  } catch { /* fallback */ }

  const { data, error } = await supabase
    .from('items')
    .select('*')
    .eq('box_id', boxId)
    .order('expiry_date', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data as Item[]) ?? [];
}

/**
 * Flat list of every item in the warehouse, joined with its box's name.
 * Used by the Items tab (cross-box expiring timeline). Sorted by nearest
 * expiry — items without a date sink to the bottom.
 */
export async function listAllItemsInWarehouse(
  warehouseId: string,
): Promise<ItemWithBox[]> {
  try {
    if (hasInitialSync()) return listAllItemsInWarehouseLocal(warehouseId);
  } catch { /* fallback */ }

  const { data, error } = await supabase
    .from('items')
    .select('*, boxes!inner(name, warehouse_id)')
    .eq('boxes.warehouse_id', warehouseId)
    .order('expiry_date', { ascending: true, nullsFirst: false });
  if (error) throw error;
  if (!data) return [];
  return data.map((row: any) => {
    const { boxes, ...item } = row;
    return { ...(item as Item), box_name: boxes?.name ?? '' };
  });
}

export interface NewItemInput {
  name: string;
  quantity: number;
  unit: Unit;
  expiry_date?: string | null;
  barcode?: string | null;
  image_url?: string | null;
  category?: Category | null;
  notes?: string | null;
  opened?: boolean;
  pack_count?: number | null;
  energy_kcal_per_100g?: number | null;
  net_weight_g?: number | null;
  min_quantity?: number | null;
}

export async function addItem(
  boxId: string,
  addedBy: string,
  input: NewItemInput,
): Promise<Item> {
  if (hasInitialSync()) {
    const item = addItemLocal(boxId, addedBy, input);
    supabase.from('items').insert({ id: item.id, box_id: boxId, added_by: addedBy, ...input })
      .then(() => {}, () => {});
    return item;
  }
  const { data, error } = await supabase
    .from('items')
    .insert({ box_id: boxId, added_by: addedBy, ...input })
    .select()
    .single();
  if (error) throw error;
  return data as Item;
}

/**
 * Batch INSERT from an add-items session.
 */
export async function addItemsBatch(
  boxId: string,
  addedBy: string,
  items: NewItemInput[],
): Promise<Item[]> {
  if (items.length === 0) return [];

  if (hasInitialSync()) {
    const result = addItemsBatchLocal(boxId, addedBy, items);
    // Background push
    const rows = result.map((i) => ({ id: i.id, box_id: boxId, added_by: addedBy, ...items[result.indexOf(i)] }));
    supabase.from('items').insert(rows).then(() => {}, () => {});
    return result;
  }

  const rows = items.map((i) => ({ box_id: boxId, added_by: addedBy, ...i }));
  const { data, error } = await supabase.from('items').insert(rows).select();
  if (error) throw error;
  return (data as Item[]) ?? [];
}

export async function updateItem(id: string, patch: Partial<NewItemInput>) {
  if (hasInitialSync()) {
    const item = updateItemLocal(id, patch);
    supabase.from('items').update(patch).eq('id', id).then(() => {}, () => {});
    return item;
  }
  const { data, error } = await supabase.from('items').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data as Item;
}

/**
 * Find an item in `targetBoxId` that matches the source item's product
 * identity (name + barcode + expiry + category + unit + pack_count +
 * opened). Used by `moveItemQuantity` to merge instead of duplicating
 * when moving items between boxes.
 */
async function findMatchingItemInBox(
  targetBoxId: string,
  src: Item,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('items')
    .select('id, name, barcode, expiry_date, category, unit, pack_count, opened')
    .eq('box_id', targetBoxId);
  if (error || !data) return null;

  const match = (data as Item[]).find(
    (row) =>
      row.name === src.name &&
      (row.barcode ?? '') === (src.barcode ?? '') &&
      (row.expiry_date ?? '') === (src.expiry_date ?? '') &&
      (row.category ?? '') === (src.category ?? '') &&
      row.unit === src.unit &&
      (row.pack_count ?? 0) === (src.pack_count ?? 0) &&
      row.opened === src.opened,
  );
  return match?.id ?? null;
}

/**
 * Unified move: move `quantity` units of an item to another box, merging
 * with an existing matching item in the target when one exists.
 *
 * Merge criteria: same name + barcode + expiry_date + category + unit +
 * pack_count + opened (identical to `open_one_item` RPC matching).
 *
 * Behaviour matrix:
 * | Match in target? | Moving all? | Result                                    |
 * |------------------|-------------|-------------------------------------------|
 * | No               | Yes         | Update source box_id (efficient, no dup)  |
 * | No               | Partial     | Decrement source, insert new in target    |
 * | Yes              | Yes         | Increment match qty, delete source        |
 * | Yes              | Partial     | Increment match qty, decrement source     |
 */
export async function moveItemQuantity(
  itemId: string,
  quantity: number | 'all',
  targetBoxId: string,
  addedBy: string,
): Promise<void> {
  if (hasInitialSync()) {
    moveItemQuantityLocal(itemId, quantity, targetBoxId, addedBy);
    // Background sync will push individual changes from queue
    return;
  }

  const { data: srcData, error: srcErr } = await supabase
    .from('items')
    .select('*')
    .eq('id', itemId)
    .single();
  if (srcErr) throw srcErr;
  if (!srcData) throw new Error('Item not found.');
  const src = srcData as Item;

  const moveQty = quantity === 'all' ? src.quantity : Math.min(quantity, src.quantity);
  const movingAll = moveQty >= src.quantity;

  // Check for a matching item in the target box.
  const matchId = await findMatchingItemInBox(targetBoxId, src);

  if (matchId) {
    // MERGE: increment the existing target row's quantity.
    const { data: matchData } = await supabase
      .from('items')
      .select('quantity')
      .eq('id', matchId)
      .single();
    const newTargetQty = ((matchData as any)?.quantity ?? 0) + moveQty;
    const { error: updErr } = await supabase
      .from('items')
      .update({ quantity: newTargetQty })
      .eq('id', matchId);
    if (updErr) throw updErr;

    // Source: delete when all moved, decrement otherwise.
    if (movingAll) {
      const { error: delErr } = await supabase.from('items').delete().eq('id', itemId);
      if (delErr) throw delErr;
    } else {
      const { error: decErr } = await supabase
        .from('items')
        .update({ quantity: src.quantity - moveQty })
        .eq('id', itemId);
      if (decErr) throw decErr;
    }
  } else {
    // NO MATCH: move or split without merging.
    if (movingAll) {
      // Efficient: just change box_id, no new row.
      const { error: mvErr } = await supabase
        .from('items')
        .update({ box_id: targetBoxId })
        .eq('id', itemId);
      if (mvErr) throw mvErr;
    } else {
      // Split: decrement source, create new in target.
      const { error: decErr } = await supabase
        .from('items')
        .update({ quantity: src.quantity - moveQty })
        .eq('id', itemId);
      if (decErr) throw decErr;
      const { error: insErr } = await supabase.from('items').insert({
        box_id: targetBoxId,
        name: src.name,
        quantity: moveQty,
        unit: src.unit,
        expiry_date: src.expiry_date,
        barcode: src.barcode,
        image_url: src.image_url,
        category: src.category,
        notes: src.notes,
        opened: src.opened,
        pack_count: src.pack_count,
        added_by: addedBy,
      });
      if (insErr) throw insErr;
    }
  }
}

/**
 * Bulk-verify items: set `last_verified = now()` for all given item IDs.
 * Used at the end of a box inventory session to stamp verified items.
 */
export async function verifyItems(itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return;
  if (hasInitialSync()) {
    verifyItemsLocal(itemIds);
    const now = new Date().toISOString();
    supabase.from('items').update({ last_verified: now }).in('id', itemIds).then(() => {}, () => {});
    return;
  }
  const { error } = await supabase
    .from('items')
    .update({ last_verified: new Date().toISOString() })
    .in('id', itemIds);
  if (error) throw error;
}

/**
 * Split off 1 unit from a multi-quantity item and apply conditions
 * (opened, damaged, notes). If qty=1, updates in-place instead of
 * splitting. No merge into existing — each conditioned unit stays as
 * its own row since notes make merge matching impractical.
 */
export async function markItemCondition(
  itemId: string,
  conditions: { opened: boolean; damaged: boolean; notes: string | null },
  addedBy: string,
): Promise<void> {
  if (hasInitialSync()) {
    markItemConditionLocal(itemId, conditions, addedBy);
    return;
  }

  const { data: srcData, error: srcErr } = await supabase
    .from('items')
    .select('*')
    .eq('id', itemId)
    .single();
  if (srcErr) throw srcErr;
  if (!srcData) throw new Error('Item not found.');
  const src = srcData as Item;

  if (src.quantity <= 1) {
    // Single unit — update in place, no split needed.
    await supabase
      .from('items')
      .update({
        opened: conditions.opened,
        damaged: conditions.damaged,
        notes: conditions.notes,
      })
      .eq('id', itemId);
    return;
  }

  // Decrement source
  const { error: decErr } = await supabase
    .from('items')
    .update({ quantity: src.quantity - 1 })
    .eq('id', itemId);
  if (decErr) throw decErr;

  // Create conditioned copy with qty=1
  const { error: insErr } = await supabase.from('items').insert({
    box_id: src.box_id,
    name: src.name,
    quantity: 1,
    unit: src.unit,
    expiry_date: src.expiry_date,
    barcode: src.barcode,
    image_url: src.image_url,
    category: src.category,
    opened: conditions.opened,
    damaged: conditions.damaged,
    notes: conditions.notes,
    pack_count: src.pack_count,
    added_by: addedBy,
  });
  if (insErr) throw insErr;
}

/**
 * "Open one unit" — atomic split via the `open_one_item` RPC.
 * Decrements (or deletes) the sealed source and upserts a matching opened
 * sibling in the same box. Returns the opened sibling row so the caller
 * can haptic + close sheet without needing to know the detail.
 */
export async function openOneItem(itemId: string): Promise<Item> {
  if (hasInitialSync()) {
    const userId = (await getActiveUserId()) ?? '';
    return openOneItemLocal(itemId, userId);
    // Background sync will push changes from queue
  }

  const { data, error } = await supabase.rpc('open_one_item', {
    source_id: itemId,
  });
  if (error) throw error;
  if (!data) throw new Error('Open action returned no row.');
  return data as Item;
}

export async function deleteItem(id: string) {
  if (hasInitialSync()) {
    deleteItemLocal(id); // handles image cleanup + box cache recalc
    supabase.from('items').delete().eq('id', id).then(() => {}, () => {});
    return;
  }

  const { data: item } = await supabase
    .from('items')
    .select('image_url')
    .eq('id', id)
    .maybeSingle();

  const { error } = await supabase.from('items').delete().eq('id', id);
  if (error) throw error;

  if ((item as any)?.image_url) {
    import('./storage').then(({ deleteProductImage }) => {
      deleteProductImage((item as any).image_url).catch(() => {});
    });
  }
}

/**
 * Realtime subscription to items in a box. Returns a cleanup fn — see
 * `subscribeBoxes` for the rationale.
 */
export function subscribeItems(boxId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`items:${boxId}:${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'items',
        filter: `box_id=eq.${boxId}`,
      },
      (payload) => {
        if (isOwnEcho('items', payload)) return;
        onChange();
      },
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

// ============================================================================
// INVITATIONS
// ============================================================================

export async function createInvitation(
  warehouseId: string,
  invitedBy: string,
  role: Role = 'member',
  email?: string | null,
): Promise<Invitation> {
  const { data, error } = await supabase
    .from('invitations')
    .insert({
      warehouse_id: warehouseId,
      invited_by: invitedBy,
      role,
      email: email ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Invitation;
}

export async function listInvitations(warehouseId: string): Promise<Invitation[]> {
  const { data, error } = await supabase
    .from('invitations')
    .select('*')
    .eq('warehouse_id', warehouseId)
    .is('accepted_at', null);
  if (error) throw error;
  return (data as Invitation[]) ?? [];
}

/**
 * Redeem an invitation token: join the warehouse with the role stored on the
 * invitation (member or co-owner), mark the invite as accepted, and return
 * the joined warehouse. Idempotent at the error layer — a duplicate accept
 * throws "already accepted".
 */
export async function acceptInvitation(token: string, userId: string): Promise<Warehouse> {
  // Uses the accept_invitation RPC (SECURITY DEFINER). Direct SELECT on
  // invitations is blocked by RLS (invitations_select requires membership),
  // so the invitee cannot redeem the token via table queries — they can't
  // even see the row they're about to consume. The RPC validates +
  // inserts membership + marks token used atomically.
  const { data: wh, error: rpcErr } = await supabase.rpc('accept_invitation', {
    invite_token: token,
  });
  if (rpcErr) throw new Error(rpcErr.message);
  if (!wh) throw new Error('Invitation not found.');

  // Persist warehouse + membership to SQLite so the list screen
  // (which reads locally via getMyWarehousesLocal) sees it immediately.
  // Without this the user lands back on "/" after accepting and doesn't
  // see the warehouse until a full re-sync.
  if (hasInitialSync()) {
    const db = (await import('./localDb')).getDb();
    const now = new Date().toISOString();
    const w = wh as Warehouse;
    db.runSync(
      `INSERT OR REPLACE INTO warehouses (id, owner_id, name, created_at, _synced, _local_updated_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [w.id, w.owner_id, w.name, w.created_at, now],
    );
    // Role from RPC is not returned directly; fetch the membership we just
    // created to capture the correct role (invitation may have been 'owner').
    const { data: myMembership } = await supabase
      .from('warehouse_members')
      .select('role, joined_at')
      .eq('warehouse_id', w.id)
      .eq('user_id', userId)
      .maybeSingle();
    db.runSync(
      `INSERT OR REPLACE INTO warehouse_members (warehouse_id, user_id, role, joined_at, _synced)
       VALUES (?, ?, ?, ?, 1)`,
      [w.id, userId, (myMembership as any)?.role ?? 'member', (myMembership as any)?.joined_at ?? now],
    );
    // Pull boxes/items/other members for the newly joined warehouse so the
    // user can open it offline right after accepting AND see everyone who
    // was already in the warehouse (settings → members list).
    try {
      const { data: otherMembers } = await supabase
        .from('warehouse_members')
        .select('*')
        .eq('warehouse_id', w.id);
      for (const m of (otherMembers ?? []) as any[]) {
        db.runSync(
          `INSERT OR REPLACE INTO warehouse_members (warehouse_id, user_id, role, joined_at, _synced)
           VALUES (?, ?, ?, ?, 1)`,
          [m.warehouse_id, m.user_id, m.role, m.joined_at],
        );
      }
      // Also pull their user profiles so display_name/email render.
      const memberUserIds = (otherMembers ?? []).map((m: any) => m.user_id);
      if (memberUserIds.length > 0) {
        const { data: memberUsers } = await supabase
          .from('users')
          .select('*')
          .in('id', memberUserIds);
        for (const u of (memberUsers ?? []) as any[]) {
          db.runSync(
            `INSERT OR REPLACE INTO users (id, email, display_name, avatar_url, created_at, _synced)
             VALUES (?, ?, ?, ?, ?, 1)`,
            [u.id, u.email, u.display_name, u.avatar_url, u.created_at],
          );
        }
      }

      const { data: boxes } = await supabase
        .from('boxes')
        .select('*')
        .eq('warehouse_id', w.id);
      for (const b of (boxes ?? []) as any[]) {
        db.runSync(
          `INSERT OR REPLACE INTO boxes (id, warehouse_id, name, location, qr_code, nearest_expiry, item_count, created_at, updated_at, _synced, _local_updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
          [b.id, b.warehouse_id, b.name, b.location, b.qr_code, b.nearest_expiry, b.item_count, b.created_at, b.updated_at, now],
        );
      }
      const boxIds = (boxes ?? []).map((b: any) => b.id);
      if (boxIds.length > 0) {
        const { data: items } = await supabase
          .from('items')
          .select('*')
          .in('box_id', boxIds);
        for (const i of (items ?? []) as any[]) {
          db.runSync(
            `INSERT OR REPLACE INTO items (id, box_id, name, quantity, unit, expiry_date, barcode, image_url, category, notes, opened, damaged, pack_count, last_verified, added_by, created_at, updated_at, _synced, _local_updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
            [i.id, i.box_id, i.name, i.quantity, i.unit, i.expiry_date, i.barcode, i.image_url, i.category, i.notes, i.opened ? 1 : 0, i.damaged ? 1 : 0, i.pack_count, i.last_verified, i.added_by, i.created_at, i.updated_at, now],
          );
        }
      }
    } catch {
      // Non-fatal — next sync cycle will pick these up.
    }
  }

  return wh as Warehouse;
}

// ============================================================================
// INVENTORY SESSIONS
// ============================================================================

export async function createInventorySession(
  boxId: string,
  performedBy: string,
): Promise<InventorySession> {
  if (hasInitialSync()) {
    const session = createInventorySessionLocal(boxId, performedBy);
    supabase.from('inventory_sessions').insert({
      id: session.id, box_id: boxId, performed_by: performedBy,
      started_at: session.started_at,
    }).then(() => {}, () => {});
    return session;
  }

  const { data, error } = await supabase
    .from('inventory_sessions')
    .insert({ box_id: boxId, performed_by: performedBy })
    .select()
    .single();
  if (error) throw error;
  return data as InventorySession;
}

export async function completeInventorySession(
  sessionId: string,
  lines: { item_id: string | null; item_name: string; item_quantity: number; item_unit: string; found_quantity: number; status: InventoryLineStatus; scanned_barcode: string | null }[],
  foundItemIds: string[],
): Promise<void> {
  if (hasInitialSync()) {
    completeInventorySessionLocal(sessionId, lines, foundItemIds);
    // Sync queue will push lines + session update + verified items
    return;
  }

  const foundCount = lines.filter((l) => l.status === 'found').length;
  const missingCount = lines.filter((l) => l.status === 'missing').length;

  // Insert all inventory lines
  if (lines.length > 0) {
    const rows = lines.map((l) => ({ session_id: sessionId, ...l }));
    const { error: lErr } = await supabase.from('inventory_lines').insert(rows);
    if (lErr) throw lErr;
  }

  // Mark session complete
  const { error: sErr } = await supabase
    .from('inventory_sessions')
    .update({
      completed_at: new Date().toISOString(),
      found_count: foundCount,
      missing_count: missingCount,
    })
    .eq('id', sessionId);
  if (sErr) throw sErr;

  // Update last_verified on found items
  if (foundItemIds.length > 0) {
    const { error: vErr } = await supabase
      .from('items')
      .update({ last_verified: new Date().toISOString() })
      .in('id', foundItemIds);
    if (vErr) throw vErr;
  }
}

export async function listInventorySessions(
  boxId: string,
): Promise<(InventorySession & { user: { display_name: string | null; email: string | null } | null })[]> {
  try {
    if (hasInitialSync()) return listInventorySessionsLocal(boxId);
  } catch { /* fallback */ }
  // Step 1: fetch sessions without join (avoids PostgREST FK detection issues)
  const { data, error } = await supabase
    .from('inventory_sessions')
    .select('*')
    .eq('box_id', boxId)
    .order('created_at', { ascending: false });
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[listInventorySessions] query error:', error.message);
    throw error;
  }
  const sessions = ((data as InventorySession[]) ?? []).filter(
    (s) => s.completed_at != null,
  );

  // Step 2: resolve user display names separately
  const userIds = [...new Set(sessions.map((s) => s.performed_by))];
  let userMap: Record<string, { display_name: string | null; email: string | null }> = {};
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, display_name, email')
      .in('id', userIds);
    for (const u of (users ?? []) as any[]) {
      userMap[u.id] = { display_name: u.display_name, email: u.email };
    }
  }

  return sessions.map((s) => ({
    ...s,
    user: userMap[s.performed_by] ?? { display_name: null, email: null },
  }));
}

export async function getInventoryLines(sessionId: string): Promise<InventoryLine[]> {
  try {
    if (hasInitialSync()) return getInventoryLinesLocal(sessionId);
  } catch { /* fallback */ }

  const { data, error } = await supabase
    .from('inventory_lines')
    .select('*')
    .eq('session_id', sessionId)
    .order('status', { ascending: true });
  if (error) throw error;
  return (data as InventoryLine[]) ?? [];
}

// ============================================================================
// INVITATIONS
// ============================================================================

// Universal Link form: opens Kalta natively when the receiver has the app
// installed (via the AASA file at https://kalta.app/.well-known/apple-app-site-association)
// and falls back to the App Store landing page if not. Far better UX than
// the old `kalta://` custom scheme, which silently fails when the app
// isn't installed.
export function buildInviteLink(token: string): string {
  return `https://kalta.app/invite/${token}`;
}

// ============================================================================
// CUSTOM PRODUCTS
// ============================================================================

export async function listCustomProducts(warehouseId: string): Promise<CustomProduct[]> {
  try {
    if (hasInitialSync()) return listCustomProductsLocal(warehouseId);
  } catch { /* fallback */ }

  const { data, error } = await supabase
    .from('custom_products')
    .select('*')
    .eq('warehouse_id', warehouseId)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data as CustomProduct[]) ?? [];
}

export async function deleteCustomProduct(id: string): Promise<void> {
  if (hasInitialSync()) {
    deleteCustomProductLocal(id);
    supabase.from('custom_products').delete().eq('id', id).then(() => {}, () => {});
    return;
  }
  const { error } = await supabase.from('custom_products').delete().eq('id', id);
  if (error) throw error;
}

export async function findCustomProduct(
  warehouseId: string,
  barcode: string,
): Promise<CustomProduct | null> {
  try {
    if (hasInitialSync()) return findCustomProductLocal(warehouseId, barcode);
  } catch { /* fallback */ }

  const { data, error } = await supabase
    .from('custom_products')
    .select('*')
    .eq('warehouse_id', warehouseId)
    .eq('barcode', barcode)
    .maybeSingle();
  if (error) throw error;
  return (data as CustomProduct) ?? null;
}

export async function upsertCustomProduct(input: {
  warehouse_id: string;
  barcode: string;
  name: string;
  category?: Category | null;
  image_url?: string | null;
  typical_expiry_days?: number | null;
  created_by: string;
}): Promise<CustomProduct> {
  if (hasInitialSync()) {
    const cp = upsertCustomProductLocal(input);
    supabase.from('custom_products')
      .upsert(input, { onConflict: 'warehouse_id,barcode' })
      .then(() => {}, () => {});
    return cp;
  }
  const { data, error } = await supabase
    .from('custom_products')
    .upsert(input, { onConflict: 'warehouse_id,barcode' })
    .select()
    .single();
  if (error) throw error;
  return data as CustomProduct;
}

/**
 * Set the aggregate par level (min_quantity) for a barcoded product. Used by
 * the smart-write par-level field — barcoded items store their threshold on
 * the shared custom_products row, not per item row.
 */
export async function setCustomProductMinQuantity(input: {
  warehouse_id: string;
  barcode: string;
  min: number | null;
  name: string;
  category?: Category | null;
  created_by: string;
}): Promise<void> {
  if (hasInitialSync()) {
    setCustomProductMinQuantityLocal(input);
    supabase
      .from('custom_products')
      .upsert(
        {
          warehouse_id: input.warehouse_id,
          barcode: input.barcode,
          name: input.name,
          category: input.category ?? null,
          created_by: input.created_by,
          min_quantity: input.min,
        },
        { onConflict: 'warehouse_id,barcode' },
      )
      .then(() => {}, () => {});
    return;
  }
  const { error } = await supabase
    .from('custom_products')
    .upsert(
      {
        warehouse_id: input.warehouse_id,
        barcode: input.barcode,
        name: input.name,
        category: input.category ?? null,
        created_by: input.created_by,
        min_quantity: input.min,
      },
      { onConflict: 'warehouse_id,barcode' },
    );
  if (error) throw error;
}

// ============================================================================
// HOUSEHOLD MEMBERS (Sprint 6) — SQLite-first; local writes enqueue for push
// ============================================================================

export async function listHouseholdMembers(warehouseId: string): Promise<HouseholdMember[]> {
  try {
    if (hasInitialSync()) return listHouseholdMembersLocal(warehouseId);
  } catch { /* fallback */ }
  const { data, error } = await supabase
    .from('household_members')
    .select('*')
    .eq('warehouse_id', warehouseId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as HouseholdMember[]) ?? [];
}

export async function addHouseholdMember(input: {
  warehouse_id: string;
  name: string;
  daily_kcal: number;
  daily_water_l: number;
  kind?: MemberKind | null;
}): Promise<HouseholdMember> {
  if (hasInitialSync()) return addHouseholdMemberLocal(input);
  const { data, error } = await supabase
    .from('household_members')
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data as HouseholdMember;
}

export async function updateHouseholdMember(
  id: string,
  patch: Partial<Pick<HouseholdMember, 'name' | 'daily_kcal' | 'daily_water_l' | 'kind'>>,
): Promise<void> {
  if (hasInitialSync()) {
    updateHouseholdMemberLocal(id, patch);
    return;
  }
  const { error } = await supabase.from('household_members').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteHouseholdMember(id: string): Promise<void> {
  if (hasInitialSync()) {
    deleteHouseholdMemberLocal(id);
    return;
  }
  const { error } = await supabase.from('household_members').delete().eq('id', id);
  if (error) throw error;
}

export async function setReadinessGoal(warehouseId: string, days: number): Promise<void> {
  if (hasInitialSync()) {
    setReadinessGoalLocal(warehouseId, days);
    return;
  }
  const { error } = await supabase
    .from('warehouses')
    .update({ readiness_goal_days: days })
    .eq('id', warehouseId);
  if (error) throw error;
}

// ============================================================================
// SHOPPING LIST (Sprint 6) — SQLite-first
// ============================================================================

export async function listShoppingList(warehouseId: string): Promise<ShoppingListItem[]> {
  try {
    if (hasInitialSync()) return listShoppingListLocal(warehouseId);
  } catch { /* fallback */ }
  const { data, error } = await supabase
    .from('shopping_list_items')
    .select('*')
    .eq('warehouse_id', warehouseId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as ShoppingListItem[]) ?? [];
}

export async function addShoppingItem(input: {
  warehouse_id: string;
  label: string;
  category?: Category | null;
  source?: ShoppingSource;
  source_ref?: string | null;
  quantity?: number | null;
}): Promise<ShoppingListItem> {
  if (hasInitialSync()) return addShoppingItemLocal(input);
  const { data, error } = await supabase
    .from('shopping_list_items')
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data as ShoppingListItem;
}

export async function setShoppingItemChecked(id: string, checked: boolean): Promise<void> {
  if (hasInitialSync()) {
    setShoppingItemCheckedLocal(id, checked);
    return;
  }
  const { error } = await supabase.from('shopping_list_items').update({ checked }).eq('id', id);
  if (error) throw error;
}

export async function deleteShoppingItem(id: string): Promise<void> {
  if (hasInitialSync()) {
    deleteShoppingItemLocal(id);
    return;
  }
  const { error } = await supabase.from('shopping_list_items').delete().eq('id', id);
  if (error) throw error;
}

// ============================================================================
// CUSTOM CHECKLISTS (Sprint 7) — SQLite-first
// ============================================================================

function parseKeywordsField(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

export async function listChecklists(warehouseId: string): Promise<Checklist[]> {
  try {
    if (hasInitialSync()) return listChecklistsLocal(warehouseId);
  } catch { /* fallback */ }
  const { data, error } = await supabase
    .from('checklists').select('*').eq('warehouse_id', warehouseId).order('created_at');
  if (error) throw error;
  return (data as Checklist[]) ?? [];
}

export async function listChecklistEntries(checklistId: string): Promise<ChecklistEntry[]> {
  try {
    if (hasInitialSync()) return listChecklistEntriesLocal(checklistId);
  } catch { /* fallback */ }
  const { data, error } = await supabase
    .from('checklist_entries').select('*').eq('checklist_id', checklistId).order('sort_order');
  if (error) throw error;
  return ((data as any[]) ?? []).map((e) => ({ ...e, keywords: parseKeywordsField(e.keywords) }));
}

export async function listChecklistSatisfactions(warehouseId: string): Promise<ChecklistSatisfaction[]> {
  try {
    if (hasInitialSync()) return listChecklistSatisfactionsLocal(warehouseId);
  } catch { /* fallback */ }
  const { data, error } = await supabase
    .from('checklist_satisfactions').select('*').eq('warehouse_id', warehouseId);
  if (error) throw error;
  return (data as ChecklistSatisfaction[]) ?? [];
}

export async function listWarehouseChecklists(warehouseId: string): Promise<WarehouseChecklist[]> {
  try {
    if (hasInitialSync()) return listWarehouseChecklistsLocal(warehouseId);
  } catch { /* fallback */ }
  const { data, error } = await supabase
    .from('warehouse_checklists').select('*').eq('warehouse_id', warehouseId);
  if (error) throw error;
  return (data as WarehouseChecklist[]) ?? [];
}

export async function createChecklist(input: {
  warehouse_id: string;
  name: string;
  is_seed?: boolean;
  goal_days?: number | null;
}): Promise<Checklist> {
  if (hasInitialSync()) return createChecklistLocal(input);
  const { data, error } = await supabase
    .from('checklists')
    .insert({ warehouse_id: input.warehouse_id, name: input.name, is_seed: input.is_seed ?? false, goal_days: input.goal_days ?? null })
    .select().single();
  if (error) throw error;
  return data as Checklist;
}

export async function updateChecklist(
  id: string,
  patch: Partial<Pick<Checklist, 'name' | 'goal_days'>>,
): Promise<void> {
  if (hasInitialSync()) { updateChecklistLocal(id, patch); return; }
  const { error } = await supabase.from('checklists').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteChecklist(id: string): Promise<void> {
  if (hasInitialSync()) { deleteChecklistLocal(id); return; }
  const { error } = await supabase.from('checklists').delete().eq('id', id);
  if (error) throw error;
}

export async function createChecklistEntry(input: {
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
}): Promise<ChecklistEntry> {
  if (hasInitialSync()) return createChecklistEntryLocal(input);
  const { data, error } = await supabase
    .from('checklist_entries')
    .insert({
      checklist_id: input.checklist_id, warehouse_id: input.warehouse_id, label: input.label,
      group_name: input.group_name ?? null, category: input.category ?? null,
      keywords: JSON.stringify(input.keywords ?? []), quantified: input.quantified ?? null,
      rationale: input.rationale ?? null, sort_order: input.sort_order ?? 0, seed_key: input.seed_key ?? null,
    })
    .select().single();
  if (error) throw error;
  return { ...(data as any), keywords: parseKeywordsField((data as any).keywords) };
}

export async function updateChecklistEntry(
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
): Promise<void> {
  if (hasInitialSync()) { updateChecklistEntryLocal(id, patch); return; }
  const serverPatch: Record<string, any> = { ...patch };
  if ('keywords' in serverPatch) serverPatch.keywords = JSON.stringify(patch.keywords ?? []);
  const { error } = await supabase.from('checklist_entries').update(serverPatch).eq('id', id);
  if (error) throw error;
}

export async function deleteChecklistEntry(id: string): Promise<void> {
  if (hasInitialSync()) { deleteChecklistEntryLocal(id); return; }
  const { error } = await supabase.from('checklist_entries').delete().eq('id', id);
  if (error) throw error;
}

export async function setChecklistSatisfaction(input: {
  checklist_entry_id: string;
  warehouse_id: string;
  mode: SatisfactionMode | null;
  item_id?: string | null;
}): Promise<void> {
  if (hasInitialSync()) { setChecklistSatisfactionLocal(input); return; }
  await supabase
    .from('checklist_satisfactions')
    .delete()
    .eq('checklist_entry_id', input.checklist_entry_id);
  if (input.mode != null) {
    const { error } = await supabase.from('checklist_satisfactions').insert({
      checklist_entry_id: input.checklist_entry_id, warehouse_id: input.warehouse_id,
      item_id: input.item_id ?? null, mode: input.mode,
    });
    if (error) throw error;
  }
}

export async function addWarehouseChecklist(input: {
  warehouse_id: string;
  checklist_id: string;
}): Promise<void> {
  if (hasInitialSync()) { addWarehouseChecklistLocal(input); return; }
  const { error } = await supabase
    .from('warehouse_checklists')
    .upsert(input, { onConflict: 'warehouse_id,checklist_id' });
  if (error) throw error;
}

export async function removeWarehouseChecklist(warehouseId: string, checklistId: string): Promise<void> {
  if (hasInitialSync()) { removeWarehouseChecklistLocal(warehouseId, checklistId); return; }
  const { error } = await supabase
    .from('warehouse_checklists').delete()
    .eq('warehouse_id', warehouseId).eq('checklist_id', checklistId);
  if (error) throw error;
}
