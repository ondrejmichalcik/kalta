// ============================================================================
// Kalta – Emergency kit coverage matching
// Each kit item has a lifecycle state across the buy → restock loop:
//
//   missing   — not on shopping list, not in inventory
//   on_list   — on shopping list, not yet checked
//   purchased — checked on shopping list, not yet restocked into inventory
//   stocked   — matched by non-expired inventory (terminal good state)
//
// Matching rules:
//   • Default keyword match is **word-boundary** (`\bword\b`) — `id` no longer
//     hits "first aid", `pas` no longer hits "pasta", etc.
//   • A `*` suffix in the keyword opens the right edge (left-anchored), used
//     for Czech stems and English plurals: `lék*` matches "lék", "léky",
//     "lékárna"; `glove*` matches "glove" and "gloves".
//   • Multi-word keywords (e.g. "duct tape") are still matched as substrings
//     because internal whitespace already prevents the short-token problem.
//
// User overrides (per-warehouse, AsyncStorage):
//   • `force_stocked` — pretend the entry is stocked even when the matcher
//      says missing (dismisses persistent false negatives).
//   • `force_missing` — pretend the entry is missing even when the matcher
//      says stocked (corrects false positives like "Pasta De Cecco" matching
//      a `pas` keyword for ID copies). The actual matched item is still
//      reported so the UI can explain what the override is reversing.
//
// Match precedence:
//   1. force_stocked override
//   2. real inventory match (unless force_missing override)
//   3. purchased shopping row
//   4. on-list shopping row
//   5. missing
// ============================================================================
import { getExpiryStatus } from '@/src/types/database';
import type { Item, ShoppingListItem } from '@/src/types/database';
import { EMERGENCY_KIT, type KitItem } from '@/src/data/emergencyKit';

export type KitState = 'stocked' | 'purchased' | 'on_list' | 'missing';
export type KitOverride = 'force_stocked' | 'force_missing';

export interface KitMatchedItem {
  id: string;
  name: string;
}

export interface KitCoverageEntry {
  item: KitItem;
  state: KitState;
  /** Convenience: state === 'stocked'. Kept for call sites that just want
   *  a yes/no (e.g. water-filter detection in readiness). */
  covered: boolean;
  /** Active user override on this entry, if any. */
  override: KitOverride | null;
  /** The inventory item the matcher hit, if any. Populated even when the
   *  user has force_missing-ed the entry so the UI can show what the
   *  override is reversing. */
  matchedItem: KitMatchedItem | null;
  /** When state is on_list / purchased, the matching shopping row id so
   *  callers can route directly to a restock action. */
  shoppingItemId: string | null;
}

export interface KitCoverageResult {
  entries: KitCoverageEntry[];
  coveredCount: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Keyword → matcher compilation. Memoized so the regex isn't rebuilt on every
// item lookup (kit list is ~24 entries × 5-10 keywords each).

const matcherCache = new Map<string, (text: string) => boolean>();

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileKeyword(kw: string): (text: string) => boolean {
  const cached = matcherCache.get(kw);
  if (cached) return cached;
  const lower = kw.toLowerCase().trim();
  let re: RegExp;
  if (lower.endsWith('*')) {
    // Left-anchored, open right edge — for Czech stems / English plurals.
    const stem = escapeRegex(lower.slice(0, -1));
    re = new RegExp(`\\b${stem}`, 'i');
  } else if (/\s/.test(lower)) {
    // Multi-word phrase ("duct tape"): keep substring since the whitespace
    // already acts as a boundary on both sides.
    const escaped = escapeRegex(lower);
    re = new RegExp(escaped, 'i');
  } else {
    // Single token: full word boundary on both sides.
    const escaped = escapeRegex(lower);
    re = new RegExp(`\\b${escaped}\\b`, 'i');
  }
  const fn = (text: string) => re.test(text);
  matcherCache.set(kw, fn);
  return fn;
}

function matchesAny(kit: KitItem, text: string): boolean {
  for (const kw of kit.keywords) {
    if (compileKeyword(kw)(text)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------

/**
 * Resolve each kit item's lifecycle state from inventory + shopping list.
 * See module header for the precedence + override rules.
 */
export function computeKitCoverage(
  items: Item[],
  overrides: Map<string, KitOverride>,
  shoppingList: ShoppingListItem[] = [],
): KitCoverageResult {
  // Pre-lower usable items once (skip expired — they don't count).
  const inventory = items
    .filter((i) => getExpiryStatus(i.expiry_date) !== 'expired')
    .map((i) => ({ id: i.id, name: i.name, lower: i.name.toLowerCase() }));

  const shoppingLowered = shoppingList.map((s) => ({
    row: s,
    label: s.label.toLowerCase(),
  }));

  const entries: KitCoverageEntry[] = EMERGENCY_KIT.map((kit) => {
    const override = overrides.get(kit.id) ?? null;

    // Find the first matching inventory item (if any) regardless of override —
    // we want to report what the matcher saw even when the user is overriding.
    let matchedItem: KitMatchedItem | null = null;
    for (const inv of inventory) {
      if (matchesAny(kit, inv.lower)) {
        matchedItem = { id: inv.id, name: inv.name };
        break;
      }
    }

    // Priority 1: force_stocked override
    if (override === 'force_stocked') {
      return {
        item: kit,
        state: 'stocked',
        covered: true,
        override,
        matchedItem,
        shoppingItemId: null,
      };
    }

    // Priority 2: real inventory match (unless overridden to missing)
    if (matchedItem && override !== 'force_missing') {
      return {
        item: kit,
        state: 'stocked',
        covered: true,
        override: null,
        matchedItem,
        shoppingItemId: null,
      };
    }

    // Shopping fallbacks — purchased trumps on_list. Direct source_ref hit
    // (kit gap rows record kit.id) is preferred over keyword match.
    let purchased: ShoppingListItem | null = null;
    let onList: ShoppingListItem | null = null;
    for (const { row, label } of shoppingLowered) {
      const directHit = row.source === 'gap' && row.source_ref === kit.id;
      const keywordHit = !directHit && matchesAny(kit, label);
      if (!directHit && !keywordHit) continue;
      if (row.checked) {
        purchased = row;
        break;
      } else if (!onList) {
        onList = row;
      }
    }

    if (purchased) {
      return {
        item: kit,
        state: 'purchased',
        covered: false,
        override,
        matchedItem,
        shoppingItemId: purchased.id,
      };
    }
    if (onList) {
      return {
        item: kit,
        state: 'on_list',
        covered: false,
        override,
        matchedItem,
        shoppingItemId: onList.id,
      };
    }
    return {
      item: kit,
      state: 'missing',
      covered: false,
      override,
      matchedItem,
      shoppingItemId: null,
    };
  });

  const coveredCount = entries.filter((e) => e.covered).length;
  return { entries, coveredCount, total: entries.length };
}
