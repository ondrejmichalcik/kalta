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
  const { error } = await supabase.from('items').delete().eq('id', id);
  if (error) throw error;
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

export function buildInviteLink(token: string): string {
  return `stockr://invite/${token}`;
}

// ============================================================================
// CUSTOM PRODUCTS
// ============================================================================

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
