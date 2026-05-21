// ============================================================================
// Kalta – Emergency kit coverage matching (Sprint 6)
// Fuzzy keyword match of checklist items against inventory item names.
// Pure + UI-free. Dismissed ids (local AsyncStorage, managed by the caller)
// are treated as covered.
// ============================================================================
import { getExpiryStatus } from '@/src/types/database';
import type { Item } from '@/src/types/database';
import { EMERGENCY_KIT, type KitItem } from '@/src/data/emergencyKit';

export interface KitCoverageEntry {
  item: KitItem;
  covered: boolean;
  /** True when coverage came from a manual dismiss rather than a match. */
  dismissed: boolean;
}

export interface KitCoverageResult {
  entries: KitCoverageEntry[];
  coveredCount: number;
  total: number;
}

/**
 * Match each checklist item against the warehouse's usable inventory.
 * An item is matched when a non-expired inventory item's name contains any
 * of its keywords (case-insensitive substring). Dismissed ids count as
 * covered regardless of a match.
 */
export function computeKitCoverage(
  items: Item[],
  dismissedIds: Set<string>,
): KitCoverageResult {
  // Pre-lower usable item names once (skip expired — they don't count).
  const names = items
    .filter((i) => getExpiryStatus(i.expiry_date) !== 'expired')
    .map((i) => i.name.toLowerCase());

  const entries: KitCoverageEntry[] = EMERGENCY_KIT.map((kit) => {
    const matched = kit.keywords.some((kw) => {
      const k = kw.toLowerCase();
      return names.some((n) => n.includes(k));
    });
    const dismissed = dismissedIds.has(kit.id);
    return { item: kit, covered: matched || dismissed, dismissed: dismissed && !matched };
  });

  const coveredCount = entries.filter((e) => e.covered).length;
  return { entries, coveredCount, total: entries.length };
}
