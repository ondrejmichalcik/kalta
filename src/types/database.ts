// ============================================================================
// Kalta – DB types + domain utilities
// ============================================================================
import { colors } from '@/src/theme';

export type Role = 'owner' | 'member';

export type Unit = 'pcs' | 'pack';

export const UNITS: Unit[] = ['pcs', 'pack'];

// Categories mirror the emergency-kit group names so the form, the readiness
// kit checklist, and the shopping list all speak the same vocabulary.
// Storage values stay snake_case; CATEGORY_LABEL provides the display text.
export type Category =
  | 'water'
  | 'food'
  | 'first_aid'
  | 'light_power'
  | 'tools_safety'
  | 'sanitation'
  | 'documents'
  | 'other';

export const CATEGORIES: Category[] = [
  'water',
  'food',
  'first_aid',
  'light_power',
  'tools_safety',
  'sanitation',
  'documents',
  'other',
];

export const CATEGORY_LABEL: Record<Category, string> = {
  water: 'Water',
  food: 'Food',
  first_aid: 'First aid',
  light_power: 'Light & power',
  tools_safety: 'Tools & safety',
  sanitation: 'Sanitation',
  documents: 'Documents',
  other: 'Other',
};

// Maps domain categories to the custom icon names rendered via <Icon>.
// Keep in sync with src/components/Icon.tsx IconName union.
export const CATEGORY_ICON: Record<Category, string> = {
  water: 'water-drop',
  food: 'food-can',
  first_aid: 'medicine-pill',
  light_power: 'flashlight-on',
  tools_safety: 'tool-wrench',
  sanitation: 'disinfectant-bottle',
  documents: 'document',
  other: 'box-generic',
};

// ----------------------------------------------------------------------------
// Tables
// ----------------------------------------------------------------------------

export interface User {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface Warehouse {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
  readiness_goal_days: number; // Sprint 6 — readiness color-coding goal (default 14)
}

// Warehouse augmented with the viewing user's role. Returned by
// `getMyWarehouses` for the Warehouses list — lets the UI render role badges
// and gate Delete / Leave / Invite without a second lookup.
export interface WarehouseWithRole extends Warehouse {
  my_role: Role;
}

export interface WarehouseMember {
  warehouse_id: string;
  user_id: string;
  role: Role;
  joined_at: string;
}

export interface Invitation {
  id: string;
  warehouse_id: string;
  invited_by: string;
  email: string | null;
  token: string;
  role: Role;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface Box {
  id: string;
  warehouse_id: string;
  name: string;
  location: string | null;
  qr_code: string;
  nearest_expiry: string | null; // ISO date
  item_count: number;
  created_at: string;
  updated_at: string;
}

export interface Item {
  id: string;
  box_id: string;
  name: string;
  quantity: number;
  unit: Unit;
  expiry_date: string | null;
  barcode: string | null;
  image_url: string | null;
  category: Category | null;
  notes: string | null;
  opened: boolean;
  damaged: boolean;
  pack_count: number | null;
  last_verified: string | null;
  added_by: string | null;
  created_at: string;
  updated_at: string;
  // Sprint 6 — readiness / par level
  energy_kcal_per_100g: number | null;
  net_weight_g: number | null; // grams per unit/package (for water: ml, 1g≈1ml)
  min_quantity: number | null; // per-row par level (no-barcode items only)
}

/**
 * Item augmented with its parent box name. Used by the cross-box Items tab
 * to show which box each item lives in without separate lookups.
 */
export interface ItemWithBox extends Item {
  box_name: string;
}

export interface CustomProduct {
  id: string;
  warehouse_id: string;
  barcode: string;
  name: string;
  category: Category | null;
  image_url: string | null;
  typical_expiry_days: number | null;
  created_by: string | null;
  created_at: string;
  min_quantity: number | null; // Sprint 6 — aggregate par level per barcode product
}

// ----------------------------------------------------------------------------
// Sprint 6 — Readiness
// ----------------------------------------------------------------------------

export interface HouseholdMember {
  id: string;
  warehouse_id: string;
  name: string;
  daily_kcal: number;
  daily_water_l: number;
  created_at: string;
}

export type ShoppingSource = 'expired' | 'low_stock' | 'gap' | 'manual';

export interface ShoppingListItem {
  id: string;
  warehouse_id: string;
  label: string;
  category: Category | null;
  source: ShoppingSource;
  source_ref: string | null;
  quantity: number | null;
  checked: boolean;
  created_at: string;
}

// Quick-fill presets for adding a household member. Values are rough
// daily-needs guidelines (editable after pick).
export interface DailyNeedPreset {
  label: string;
  daily_kcal: number;
  daily_water_l: number;
}

export const DAILY_NEED_PRESETS: DailyNeedPreset[] = [
  { label: 'Adult male', daily_kcal: 2500, daily_water_l: 3.0 },
  { label: 'Adult female', daily_kcal: 2000, daily_water_l: 2.5 },
  { label: 'Teenager', daily_kcal: 2200, daily_water_l: 2.5 },
  { label: 'Child (4–8)', daily_kcal: 1400, daily_water_l: 1.5 },
  { label: 'Toddler', daily_kcal: 1200, daily_water_l: 1.0 },
];

export interface InventorySession {
  id: string;
  box_id: string;
  performed_by: string;
  started_at: string;
  completed_at: string | null;
  found_count: number;
  missing_count: number;
  notes: string | null;
  created_at: string;
}

export type InventoryLineStatus = 'found' | 'missing' | 'partial';

export interface InventoryLine {
  id: string;
  session_id: string;
  item_id: string | null;
  item_name: string;
  item_quantity: number;
  item_unit: string;
  found_quantity: number;
  status: InventoryLineStatus;
  scanned_barcode: string | null;
  created_at: string;
}

// ----------------------------------------------------------------------------
// Expiry status
// ----------------------------------------------------------------------------

export type ExpiryStatus = 'ok' | 'soon' | 'critical' | 'expired' | 'none' | 'never';

/**
 * Sentinel ISO date stored in `expiry_date` for items the user has marked
 * as never-expiring. Real-world dates can't reach this — using a date
 * keeps the column schema simple and lets every code path that already
 * handles `string | null` accept it without a separate column.
 */
export const NEVER_EXPIRES_DATE = '9999-12-31';

export function isNeverExpires(dateStr: string | null | undefined): boolean {
  return dateStr === NEVER_EXPIRES_DATE;
}

export interface ExpiryPalette {
  bg: string;
  fg: string;
}

// Simplified 3-color scheme: red (expired) → yellow (≤3 mo) → green (>3 mo).
// "critical" and "soon" share the same yellow palette — the distinction
// only matters for sort priority, not visual treatment.
export const EXPIRY_COLORS: Record<Exclude<ExpiryStatus, 'none'>, ExpiryPalette> = {
  ok: { bg: colors.expiryOkBg, fg: colors.expiryOkText },
  soon: { bg: colors.expirySoonBg, fg: colors.expirySoonText },
  critical: { bg: colors.expirySoonBg, fg: colors.expirySoonText },
  expired: { bg: colors.expiryExpiredBg, fg: colors.expiryExpiredText },
  // "never" reuses the neutral grey treatment so it visually distinguishes
  // itself from the actual expiry colors (ok / soon / critical / expired).
  never: { bg: colors.expiryNoneBg, fg: colors.expiryNoneText },
};

/**
 * Days between `dateStr` (ISO YYYY-MM-DD) and today. Positive = future.
 */
export function daysUntil(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  const diffMs = target.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

export function getExpiryStatus(dateStr: string | null): ExpiryStatus {
  if (!dateStr) return 'none';
  if (isNeverExpires(dateStr)) return 'never';
  const days = daysUntil(dateStr);
  if (days < 0) return 'expired';
  if (days <= 30) return 'critical';
  if (days <= 90) return 'soon';
  return 'ok';
}

/**
 * Render the numeric line for list views: "10 pcs" plain, or "10 pcs ·
 * 24/pack" when pack_count is set. Keeps all numeric info on one subtitle
 * line so the title stays clean (just product name) and "N pcs" never
 * appears twice with different meanings.
 */
export function formatItemQuantity(
  item: Pick<Item, 'quantity' | 'unit' | 'pack_count'>,
): string {
  const qty = Number.isInteger(item.quantity)
    ? String(item.quantity)
    : item.quantity.toFixed(1);
  const base = `${qty} ${item.unit}`;
  if (item.pack_count && item.pack_count > 0) {
    return `${base} · ${item.pack_count}/pack`;
  }
  return base;
}

/**
 * Format ISO YYYY-MM-DD to "15. 3. 2027" (DD. M. YYYY).
 */
export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  return `${d}. ${m}. ${y}`;
}

/**
 * Convert JS Date to ISO YYYY-MM-DD (local timezone, not UTC).
 */
export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Convert ISO YYYY-MM-DD to a local-timezone JS Date.
 */
export function fromIsoDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function formatExpiry(dateStr: string | null): string {
  if (!dateStr) return 'No date';
  if (isNeverExpires(dateStr)) return 'Never';
  const days = daysUntil(dateStr);
  if (days < 0) return 'Expired';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days <= 30) return `${days}d`;
  if (days <= 365) return `${Math.round(days / 30)} mo`;
  return `${Math.round(days / 365)} yr`;
}

/**
 * Compare function for sorting boxes: expired → critical → soon → ok → none.
 * Within the same category: nearest expiry first.
 */
const STATUS_ORDER: Record<ExpiryStatus, number> = {
  expired: 0,
  critical: 1,
  soon: 2,
  ok: 3,
  // Items marked "never expires" sort after dated items but before the
  // ones with no date set — they're a deliberate decision, not pending input.
  never: 4,
  none: 5,
};

export function compareBoxesByExpiry(a: Box, b: Box): number {
  const sa = getExpiryStatus(a.nearest_expiry);
  const sb = getExpiryStatus(b.nearest_expiry);
  if (sa !== sb) return STATUS_ORDER[sa] - STATUS_ORDER[sb];
  if (a.nearest_expiry && b.nearest_expiry) {
    return a.nearest_expiry.localeCompare(b.nearest_expiry);
  }
  return a.name.localeCompare(b.name);
}

/**
 * Format the "last verified" timestamp as a human-readable relative string.
 * Returns null when the item has never been verified.
 */
export function formatVerified(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const verified = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - verified.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Verified today';
  if (days === 1) return 'Verified yesterday';
  if (days < 30) return `Verified ${days}d ago`;
  if (days < 365) return `Verified ${Math.round(days / 30)}mo ago`;
  return `Verified ${Math.round(days / 365)}y ago`;
}

/**
 * Item sort: expired → critical → soon → ok → none, and **within each
 * group opened items first**. An opened pack with critical expiry still
 * sinks below an expired sealed pack — the idea is "finish what's already
 * started before opening a new one, but only after dealing with things
 * that are outright dead."
 */
export function compareItemsByPriority<
  T extends Pick<Item, 'opened' | 'expiry_date' | 'name'>,
>(a: T, b: T): number {
  const sa = getExpiryStatus(a.expiry_date);
  const sb = getExpiryStatus(b.expiry_date);
  if (sa !== sb) return STATUS_ORDER[sa] - STATUS_ORDER[sb];
  if (a.opened !== b.opened) return a.opened ? -1 : 1;
  if (a.expiry_date && b.expiry_date) {
    return a.expiry_date.localeCompare(b.expiry_date);
  }
  return a.name.localeCompare(b.name);
}
