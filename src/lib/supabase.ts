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
  Unit,
  Warehouse,
  WarehouseMember,
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
 * Vrátí **nejstarší** sklad, kterého je uživatel členem. Stockr je single-warehouse
 * UX, ale schema podporuje více. Ordering by `joined_at asc` zajišťuje, že všechny
 * části appky (Dashboard, box/new, scan) vidí **stejný** warehouse pro stejného
 * usera — jinak by různé callsitey mohly vrátit různé warehouses při multi-warehouse
 * situaci (např. po pozvánce).
 */
export async function getMyWarehouse(userId: string): Promise<Warehouse | null> {
  const { data, error } = await supabase
    .from('warehouse_members')
    .select('warehouse_id, joined_at, warehouses(*)')
    .eq('user_id', userId)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data?.warehouses as unknown as Warehouse) ?? null;
}

/**
 * Vytvoří nový sklad a automaticky přidá zakladatele jako ownera.
 * Používá SECURITY DEFINER RPC funkci create_warehouse_for_me, která
 * bypassne RLS a udělá oba inserty atomicky. Viz supabase/fix-warehouse-rpc.sql.
 *
 * Parametr `userId` zůstává pro API kompatibilitu — RPC používá auth.uid() uvnitř.
 */
export async function createWarehouse(_userId: string, name: string): Promise<Warehouse> {
  const { data, error } = await supabase.rpc('create_warehouse_for_me', { wh_name: name });
  if (error) throw error;
  if (!data) throw new Error('Warehouse was not created.');
  return data as Warehouse;
}

/**
 * Ensures the user has a warehouse. If not, creates "Home" as the default.
 */
export async function ensureWarehouse(userId: string): Promise<Warehouse> {
  const existing = await getMyWarehouse(userId);
  if (existing) return existing;
  return createWarehouse(userId, 'Home');
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
  email: string,
): Promise<Invitation> {
  const { data, error } = await supabase
    .from('invitations')
    .insert({ warehouse_id: warehouseId, invited_by: invitedBy, email })
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
 * Přijetí pozvánky: ověř token, přidej usera jako membera, označ přijato.
 */
export async function acceptInvitation(token: string, userId: string): Promise<Warehouse> {
  const { data: inv, error: invErr } = await supabase
    .from('invitations')
    .select('*')
    .eq('token', token)
    .maybeSingle();
  if (invErr) throw invErr;
  if (!inv) throw new Error('Pozvánka neexistuje.');
  if (inv.accepted_at) throw new Error('Pozvánka už byla přijata.');
  if (new Date(inv.expires_at).getTime() < Date.now()) {
    throw new Error('Pozvánka vypršela.');
  }

  const { error: memErr } = await supabase.from('warehouse_members').insert({
    warehouse_id: inv.warehouse_id,
    user_id: userId,
    role: 'member',
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
