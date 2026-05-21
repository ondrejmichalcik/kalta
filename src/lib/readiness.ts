// ============================================================================
// Kalta – Readiness calc engine (Sprint 6)
// Pure, UI-free, unit-testable. Answers "how many days can the household
// survive on what's in this warehouse?" from food (kcal) and water (volume).
//
// Spec (implementation-plan.md step 3):
//  - Unit normalization via net_weight_g: water density ≈ 1 g/ml, so one
//    field serves food grams and water ml.
//  - Expired (expiry_date < today) and damaged items are excluded. Never-
//    expires and undated items are included (usable).
//  - Opened items count at full value in v1 (slight over-count, acceptable).
//  - Food without energy_kcal_per_100g, or pcs/pack without net_weight_g →
//    can't be computed → counted as uncounted.
//  - pack_count is NOT used (it's a display hint, not content weight).
//  - Per-member needs summed; empty household → foodDays/waterDays = null.
// ============================================================================
import { getExpiryStatus } from '@/src/types/database';
import type { HouseholdMember, Item } from '@/src/types/database';

export interface CategoryCoverage {
  /** Days of supply at current household consumption, or null if needs are 0. */
  days: number | null;
  /** Total usable kcal (food) — undefined for water. */
  totalKcal?: number;
  /** Total usable litres (water) — undefined for food. */
  totalL?: number;
}

export interface ReadinessResult {
  foodDays: number | null;
  waterDays: number | null;
  /** Lowest non-null of foodDays/waterDays, with its category. null if both null. */
  weakestLink: { category: 'food' | 'water'; days: number } | null;
  perCategory: { food: CategoryCoverage; water: CategoryCoverage };
  /** Count of food/water items that couldn't be quantified (missing data). */
  uncountedItems: number;
  totalDailyKcal: number;
  totalDailyWaterL: number;
}

/**
 * Convert an item's quantity+unit into total grams of content (≈ ml for
 * liquids). Returns null when it can't be determined — e.g. discrete
 * pcs/pack rows without a net_weight_g to multiply by.
 */
function itemTotalGrams(item: Item): number | null {
  switch (item.unit) {
    case 'g':
      return item.quantity;
    case 'kg':
      return item.quantity * 1000;
    case 'ml':
      return item.quantity;
    case 'l':
      return item.quantity * 1000;
    case 'pcs':
    case 'pack':
      return item.net_weight_g != null ? item.quantity * item.net_weight_g : null;
    default:
      return null;
  }
}

/** True if the item must be skipped entirely (unsafe / unusable). */
function isExcluded(item: Item): boolean {
  if (item.damaged) return true;
  if (getExpiryStatus(item.expiry_date) === 'expired') return true;
  return false;
}

export function computeReadiness(
  items: Item[],
  members: HouseholdMember[],
): ReadinessResult {
  const totalDailyKcal = members.reduce((sum, m) => sum + (m.daily_kcal || 0), 0);
  const totalDailyWaterL = members.reduce((sum, m) => sum + (m.daily_water_l || 0), 0);

  let totalKcal = 0;
  let totalWaterL = 0;
  let uncountedItems = 0;

  for (const item of items) {
    if (item.category !== 'food' && item.category !== 'water') continue;
    if (isExcluded(item)) continue;

    const grams = itemTotalGrams(item);

    if (item.category === 'food') {
      if (grams == null || item.energy_kcal_per_100g == null) {
        uncountedItems++;
        continue;
      }
      totalKcal += (item.energy_kcal_per_100g / 100) * grams;
    } else {
      // water — kcal not required, but we still need a quantifiable volume
      if (grams == null) {
        uncountedItems++;
        continue;
      }
      totalWaterL += grams / 1000;
    }
  }

  const foodDays = totalDailyKcal > 0 ? totalKcal / totalDailyKcal : null;
  const waterDays = totalDailyWaterL > 0 ? totalWaterL / totalDailyWaterL : null;

  let weakestLink: ReadinessResult['weakestLink'] = null;
  if (foodDays != null && waterDays != null) {
    weakestLink =
      foodDays <= waterDays
        ? { category: 'food', days: foodDays }
        : { category: 'water', days: waterDays };
  } else if (foodDays != null) {
    weakestLink = { category: 'food', days: foodDays };
  } else if (waterDays != null) {
    weakestLink = { category: 'water', days: waterDays };
  }

  return {
    foodDays,
    waterDays,
    weakestLink,
    perCategory: {
      food: { days: foodDays, totalKcal },
      water: { days: waterDays, totalL: totalWaterL },
    },
    uncountedItems,
    totalDailyKcal,
    totalDailyWaterL,
  };
}
