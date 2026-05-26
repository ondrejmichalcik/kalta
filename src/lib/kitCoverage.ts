// ============================================================================
// Kalta – Emergency kit coverage matching (Sprint 6)
// Each kit item now has a lifecycle state across the buy → restock loop:
//
//   missing   — not on shopping list, not in inventory
//   on_list   — on shopping list, not yet checked
//   purchased — checked on shopping list, not yet restocked into inventory
//   stocked   — matched by non-expired inventory (terminal good state)
//
// Inventory match wins over shopping state — once you've actually stocked it,
// the row is green regardless of any leftover shopping list entries. If the
// inventory match later disappears (expired, deleted), the entry falls back
// down the chain. Dismissed ids (local AsyncStorage, managed by the caller)
// override to stocked.
// ============================================================================
import { getExpiryStatus } from '@/src/types/database';
import type { Item, ShoppingListItem } from '@/src/types/database';
import { EMERGENCY_KIT, type KitItem } from '@/src/data/emergencyKit';

export type KitState = 'stocked' | 'purchased' | 'on_list' | 'missing';

export interface KitCoverageEntry {
  item: KitItem;
  state: KitState;
  /** Convenience flag: stocked or dismissed-as-stocked. Kept for call sites
   *  (e.g. water-filter detection in readiness) that just want a yes/no. */
  covered: boolean;
  /** True when stocked state came from a manual dismiss, not a real match. */
  dismissed: boolean;
  /** When state is on_list / purchased, the matching shopping row id so
   *  callers can route directly to a restock action. */
  shoppingItemId: string | null;
}

export interface KitCoverageResult {
  entries: KitCoverageEntry[];
  coveredCount: number;
  total: number;
}

/**
 * Resolve each kit item's lifecycle state from inventory + shopping list.
 * Match precedence is inventory > purchased > on_list > missing; dismiss
 * is treated as stocked. Shopping rows match by source_ref (kit gap rows
 * carry kit.id) or by the same keyword scan as inventory.
 */
export function computeKitCoverage(
  items: Item[],
  dismissedIds: Set<string>,
  shoppingList: ShoppingListItem[] = [],
): KitCoverageResult {
  // Pre-lower usable item names once (skip expired — they don't count).
  const inventoryNames = items
    .filter((i) => getExpiryStatus(i.expiry_date) !== 'expired')
    .map((i) => i.name.toLowerCase());

  const shoppingLowered = shoppingList.map((s) => ({
    row: s,
    label: s.label.toLowerCase(),
  }));

  const entries: KitCoverageEntry[] = EMERGENCY_KIT.map((kit) => {
    const dismissed = dismissedIds.has(kit.id);

    const stocked = kit.keywords.some((kw) => {
      const k = kw.toLowerCase();
      return inventoryNames.some((n) => n.includes(k));
    });

    if (stocked || dismissed) {
      return {
        item: kit,
        state: 'stocked' as KitState,
        covered: true,
        dismissed: dismissed && !stocked,
        shoppingItemId: null,
      };
    }

    // Look for matching shopping rows. Prefer source_ref equality (kit gap
    // rows record kit.id explicitly), fall back to keyword on the label.
    let purchased: ShoppingListItem | null = null;
    let onList: ShoppingListItem | null = null;
    for (const { row, label } of shoppingLowered) {
      const directHit = row.source === 'gap' && row.source_ref === kit.id;
      const keywordHit =
        !directHit &&
        kit.keywords.some((kw) => label.includes(kw.toLowerCase()));
      if (!directHit && !keywordHit) continue;
      if (row.checked) {
        purchased = row;
        break; // purchased trumps on_list, no need to keep scanning
      } else if (!onList) {
        onList = row;
      }
    }

    if (purchased) {
      return {
        item: kit,
        state: 'purchased' as KitState,
        covered: false,
        dismissed: false,
        shoppingItemId: purchased.id,
      };
    }
    if (onList) {
      return {
        item: kit,
        state: 'on_list' as KitState,
        covered: false,
        dismissed: false,
        shoppingItemId: onList.id,
      };
    }
    return {
      item: kit,
      state: 'missing' as KitState,
      covered: false,
      dismissed: false,
      shoppingItemId: null,
    };
  });

  // coveredCount keeps its old meaning ("done") — only stocked entries.
  const coveredCount = entries.filter((e) => e.covered).length;
  return { entries, coveredCount, total: entries.length };
}
