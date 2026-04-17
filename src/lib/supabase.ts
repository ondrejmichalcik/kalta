// ============================================================================
// Stockr – Supabase client + API
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
} from '@/src/types/database';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
// Nový publishable key (sb_publishable_...), nahrazuje legacy anon key
const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    '[stockr] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY – nastav je v .env',
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

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
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
 * Vytvoří nový sklad a automaticky přidá zakladatele jako ownera.
 * Používá SECURITY DEFINER RPC funkci create_warehouse_for_me, která
 * bypassne RLS a udělá oba inserty atomicky. Viz schema.sql.
 *
 * Parametr `userId` zůstává pro API kompatibilitu — RPC používá auth.uid() uvnitř.
 */
export async function createWarehouse(_userId: string, name: string): Promise<Warehouse> {
  const { data, error } = await supabase.rpc('create_warehouse_for_me', { wh_name: name });
  if (error) throw error;
  if (!data) throw new Error('Warehouse was not created.');
  return data as Warehouse;
}

export async function getWarehouseById(id: string): Promise<Warehouse | null> {
  const { data, error } = await supabase
    .from('warehouses')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as Warehouse) ?? null;
}

export async function renameWarehouse(id: string, name: string): Promise<Warehouse> {
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
      () => onChange(),
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
  const { data, error } = await supabase
    .from('boxes')
    .select('*')
    .eq('warehouse_id', warehouseId);
  if (error) throw error;
  return (data as Box[]) ?? [];
}

export async function getBoxById(id: string): Promise<Box | null> {
  const { data, error } = await supabase.from('boxes').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as Box) ?? null;
}

export async function getBoxByQr(qrCode: string): Promise<Box | null> {
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
  const { data, error } = await supabase.from('boxes').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data as Box;
}

export async function deleteBox(id: string) {
  const { error } = await supabase.from('boxes').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Realtime subscription na změny beden v daném skladu.
 * Vrací cleanup fn, kterou volající zavolá v useEffect return (plně odstraní
 * channel z klienta, ne jen unsubscribe — jinak Strict Mode re-mount narazí na
 * "cannot add callbacks after subscribe").
 */
export function subscribeBoxes(warehouseId: string, onChange: () => void): () => void {
  const channel = supabase
    // Unique name per call — zabrání cached channel re-use
    .channel(`boxes:${warehouseId}:${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'boxes',
        filter: `warehouse_id=eq.${warehouseId}`,
      },
      () => onChange(),
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
}

export async function addItem(
  boxId: string,
  addedBy: string,
  input: NewItemInput,
): Promise<Item> {
  const { data, error } = await supabase
    .from('items')
    .insert({ box_id: boxId, added_by: addedBy, ...input })
    .select()
    .single();
  if (error) throw error;
  return data as Item;
}

/**
 * Batch INSERT z naskladňovací session.
 */
export async function addItemsBatch(
  boxId: string,
  addedBy: string,
  items: NewItemInput[],
): Promise<Item[]> {
  if (items.length === 0) return [];
  const rows = items.map((i) => ({ box_id: boxId, added_by: addedBy, ...i }));
  const { data, error } = await supabase.from('items').insert(rows).select();
  if (error) throw error;
  return (data as Item[]) ?? [];
}

export async function updateItem(id: string, patch: Partial<NewItemInput>) {
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
  const { data, error } = await supabase.rpc('open_one_item', {
    source_id: itemId,
  });
  if (error) throw error;
  if (!data) throw new Error('Open action returned no row.');
  return data as Item;
}

export async function deleteItem(id: string) {
  // Fetch image_url before deleting so we can clean up storage.
  const { data: item } = await supabase
    .from('items')
    .select('image_url')
    .eq('id', id)
    .maybeSingle();

  const { error } = await supabase.from('items').delete().eq('id', id);
  if (error) throw error;

  // Fire-and-forget: clean up product image from Storage if it's ours.
  // deleteProductImage safely no-ops for external URLs (OFF thumbnails).
  if ((item as any)?.image_url) {
    import('./storage').then(({ deleteProductImage }) => {
      deleteProductImage((item as any).image_url).catch(() => {});
    });
  }
}

/**
 * Realtime subscription na items v dané bedně.
 * Vrací cleanup fn — viz `subscribeBoxes` pro vysvětlení.
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
      () => onChange(),
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
  const { data: inv, error: invErr } = await supabase
    .from('invitations')
    .select('*')
    .eq('token', token)
    .maybeSingle();
  if (invErr) throw invErr;
  if (!inv) throw new Error('Invitation not found.');
  if (inv.accepted_at) throw new Error('This invitation has already been used.');
  if (new Date(inv.expires_at).getTime() < Date.now()) {
    throw new Error('This invitation has expired.');
  }

  const { error: memErr } = await supabase.from('warehouse_members').insert({
    warehouse_id: inv.warehouse_id,
    user_id: userId,
    role: inv.role ?? 'member',
  });
  if (memErr) throw memErr;

  const { error: updErr } = await supabase
    .from('invitations')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', inv.id);
  if (updErr) throw updErr;

  const { data: wh, error: whErr } = await supabase
    .from('warehouses')
    .select('*')
    .eq('id', inv.warehouse_id)
    .single();
  if (whErr) throw whErr;
  return wh as Warehouse;
}

// ============================================================================
// INVENTORY SESSIONS
// ============================================================================

export async function createInventorySession(
  boxId: string,
  performedBy: string,
): Promise<InventorySession> {
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

export function buildInviteLink(token: string): string {
  return `stockr://invite/${token}`;
}

// ============================================================================
// CUSTOM PRODUCTS
// ============================================================================

export async function listCustomProducts(warehouseId: string): Promise<CustomProduct[]> {
  const { data, error } = await supabase
    .from('custom_products')
    .select('*')
    .eq('warehouse_id', warehouseId)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data as CustomProduct[]) ?? [];
}

export async function deleteCustomProduct(id: string): Promise<void> {
  const { error } = await supabase.from('custom_products').delete().eq('id', id);
  if (error) throw error;
}

export async function findCustomProduct(
  warehouseId: string,
  barcode: string,
): Promise<CustomProduct | null> {
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
  const { data, error } = await supabase
    .from('custom_products')
    .upsert(input, { onConflict: 'warehouse_id,barcode' })
    .select()
    .single();
  if (error) throw error;
  return data as CustomProduct;
}
