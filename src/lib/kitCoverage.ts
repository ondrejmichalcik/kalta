// ============================================================================
// Kalta – Emergency kit coverage matching
// Each kit item has a lifecycle state across the buy → restock loop:
//
//   missing        — not on shopping list, not in inventory
//   on_list        — on shopping list, not yet checked
//   purchased      — checked on shopping list, not yet restocked into inventory
//   partial        — quantified entry (food/water) with some supply but below
//                    the readiness goal (e.g. 4 of 14 days)
//   stocked        — matched by non-expired inventory (terminal good state)
//   not_applicable — user marked the entry irrelevant for this warehouse; it
//                    drops out of the coverage denominator entirely
//
// Matching rules:
//   • Search text is the item NAME plus its NOTES (lower-cased once).
//   • Default keyword match is **word-boundary** (`\bword\b`) — `id` no longer
//     hits "first aid", `pas` no longer hits "pasta", etc.
//   • A `*` suffix in the keyword opens the right edge (left-anchored), used
//     for Czech stems and English plurals: `lék*` matches "lék", "léky",
//     "lékárna"; `glove*` matches "glove" and "gloves".
//   • Multi-word keywords (e.g. "duct tape") are still matched as substrings
//     because internal whitespace already prevents the short-token problem.
//   • CATEGORY is a soft positive signal: for the broad quantified entries
//     (water / food) an inventory item in the same domain category counts even
//     if the name contains no keyword. Category never *removes* a keyword match
//     (OFF mapping is heuristic and often null), so it can only add coverage.
//
// Quantified entries (water / food) are coverage-by-days when a readiness
// result is supplied: their state reflects how close stored supply is to the
// goal instead of a misleading ✓ on a single bottle.
//
// User overrides (per-warehouse):
//   • `force_stocked`  — pretend stocked even when the matcher says missing.
//   • `force_missing`  — pretend missing even when the matcher says stocked
//                        (corrects false positives). The matched item is still
//                        reported so the UI can explain the override.
//   • `not_applicable` — the entry is irrelevant for this warehouse; excluded
//                        from coveredCount / total and never surfaced as a gap.
//
// Match precedence:
//   1. not_applicable override
//   2. force_stocked override
//   3. quantified days-derived state (when readiness supplied, not force_missing)
//   4. real inventory match (unless force_missing override)
//   5. purchased shopping row
//   6. on-list shopping row
//   7. missing
// ============================================================================
import { getExpiryStatus } from '@/src/types/database';
import type { Category, Item, ShoppingListItem } from '@/src/types/database';
import { EMERGENCY_KIT, type KitItem } from '@/src/data/emergencyKit';
import type { ReadinessResult } from '@/src/lib/readiness';

export type KitState = 'stocked' | 'partial' | 'purchased' | 'on_list' | 'missing' | 'not_applicable';
export type KitOverride = 'force_stocked' | 'force_missing' | 'not_applicable';

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
  /** False when the user marked the entry not_applicable. Such entries are
   *  excluded from coveredCount / total. */
  applicable: boolean;
  /** Active user override on this entry, if any. */
  override: KitOverride | null;
  /** The inventory item the matcher hit, if any. Populated even when the
   *  user has force_missing-ed the entry so the UI can show what the
   *  override is reversing. */
  matchedItem: KitMatchedItem | null;
  /** When state is on_list / purchased, the matching shopping row id so
   *  callers can route directly to a restock action. */
  shoppingItemId: string | null;
  /** Days of supply for quantified entries (food/water), when known. Drives
   *  the "4 of 14 days" partial label. null for non-quantified entries. */
  days: number | null;
}

export interface KitCoverageResult {
  entries: KitCoverageEntry[];
  /** Count of stocked entries among applicable ones. */
  coveredCount: number;
  /** Count of applicable entries (excludes not_applicable). */
  total: number;
}

export interface KitCoverageOptions {
  /** When supplied, quantified entries (water/food) become coverage-by-days. */
  readiness?: ReadinessResult;
  /** Readiness goal in days — the denominator for partial vs stocked. */
  goalDays?: number;
  /** The checklist entries to evaluate. Defaults to the hardcoded FEMA kit;
   *  custom/DB-backed checklists pass their own KitItem[] here. */
  entries?: KitItem[];
  /** Manual pins: entry id → inventory item id. A pinned entry counts as
   *  stocked as long as that item still exists and isn't expired. */
  pins?: Map<string, string>;
}

// ---------------------------------------------------------------------------
// Keyword → matcher compilation. Memoized so the regex isn't rebuilt on every
// item lookup (kit list is ~28 entries × 5-10 keywords each).

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

function matchesAnyKeyword(kit: KitItem, text: string): boolean {
  for (const kw of kit.keywords) {
    if (compileKeyword(kw)(text)) return true;
  }
  return false;
}

/**
 * Does this inventory item satisfy the kit entry? Keyword match against the
 * item's name+notes, plus a soft category boost: a category match alone is
 * enough for the broad quantified entries (water / food). Category never
 * removes a keyword match.
 */
function itemSatisfies(
  kit: KitItem,
  inv: { text: string; category: Category | null },
): boolean {
  if (kit.category && kit.quantified && inv.category === kit.category) return true;
  return matchesAnyKeyword(kit, inv.text);
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
  options: KitCoverageOptions = {},
): KitCoverageResult {
  const { readiness, goalDays = 14, entries: kitList = EMERGENCY_KIT, pins } = options;

  // Pre-lower usable items once (skip expired — they don't count). Search text
  // combines name + notes so a note like "AA for radio" matches the radio.
  const inventory = items
    .filter((i) => getExpiryStatus(i.expiry_date) !== 'expired')
    .map((i) => ({
      id: i.id,
      name: i.name,
      category: i.category,
      text: `${i.name} ${i.notes ?? ''}`.toLowerCase(),
    }));
  const inventoryById = new Map(inventory.map((i) => [i.id, i]));

  const shoppingLowered = shoppingList.map((s) => ({
    row: s,
    label: s.label.toLowerCase(),
  }));

  const entries: KitCoverageEntry[] = kitList.map((kit) => {
    const override = overrides.get(kit.id) ?? null;

    // Find the first matching inventory item (if any) regardless of override —
    // we want to report what the matcher saw even when the user is overriding.
    let matchedItem: KitMatchedItem | null = null;
    for (const inv of inventory) {
      if (itemSatisfies(kit, inv)) {
        matchedItem = { id: inv.id, name: inv.name };
        break;
      }
    }

    const base = {
      item: kit,
      override,
      matchedItem,
      shoppingItemId: null as string | null,
      days: null as number | null,
    };

    // Priority 1: not_applicable — excluded from the denominator entirely.
    if (override === 'not_applicable') {
      return { ...base, state: 'not_applicable' as KitState, covered: false, applicable: false };
    }

    // Priority 2: force_stocked override
    if (override === 'force_stocked') {
      return { ...base, state: 'stocked' as KitState, covered: true, applicable: true };
    }

    // Priority 3: manual pin — covered while the pinned item still exists and
    // isn't expired (expired items aren't in `inventory`).
    const pinnedId = pins?.get(kit.id);
    if (pinnedId && override !== 'force_missing') {
      const pinned = inventoryById.get(pinnedId);
      if (pinned) {
        return {
          ...base,
          state: 'stocked' as KitState,
          covered: true,
          applicable: true,
          matchedItem: { id: pinned.id, name: pinned.name },
        };
      }
    }

    // Priority 4: quantified days-derived state (water/food) when we have a
    // readiness figure and the user hasn't forced it missing.
    if (kit.quantified && readiness && override !== 'force_missing') {
      const days =
        kit.quantified === 'food' ? readiness.foodDays : readiness.waterDays;
      const filterCovered = kit.quantified === 'water' && readiness.hasWaterFilter;
      if (filterCovered) {
        return { ...base, state: 'stocked' as KitState, covered: true, applicable: true };
      }
      if (days != null) {
        const ratio = goalDays > 0 ? days / goalDays : 0;
        const state: KitState = ratio >= 1 ? 'stocked' : ratio > 0 ? 'partial' : 'missing';
        // partial/stocked are terminal here; missing falls through so the user
        // can still see shopping-list status for it.
        if (state !== 'missing') {
          return { ...base, state, covered: state === 'stocked', applicable: true, days };
        }
        base.days = days;
      }
      // days == null (no household configured) → fall through to keyword path.
    }

    // Priority 4: real inventory match (unless overridden to missing)
    if (matchedItem && override !== 'force_missing') {
      return { ...base, state: 'stocked' as KitState, covered: true, applicable: true };
    }

    // Shopping fallbacks — purchased trumps on_list. Direct source_ref hit
    // (kit gap rows record kit.id) is preferred over keyword match.
    let purchased: ShoppingListItem | null = null;
    let onList: ShoppingListItem | null = null;
    for (const { row, label } of shoppingLowered) {
      const directHit = row.source === 'gap' && row.source_ref === kit.id;
      const keywordHit = !directHit && matchesAnyKeyword(kit, label);
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
        ...base,
        state: 'purchased' as KitState,
        covered: false,
        applicable: true,
        shoppingItemId: purchased.id,
      };
    }
    if (onList) {
      return {
        ...base,
        state: 'on_list' as KitState,
        covered: false,
        applicable: true,
        shoppingItemId: onList.id,
      };
    }
    return { ...base, state: 'missing' as KitState, covered: false, applicable: true };
  });

  const applicable = entries.filter((e) => e.applicable);
  const coveredCount = applicable.filter((e) => e.covered).length;
  return { entries, coveredCount, total: applicable.length };
}
