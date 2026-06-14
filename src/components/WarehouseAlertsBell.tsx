// ============================================================================
// Kalta – WarehouseAlertsBell
// Header indicator scoped to a single warehouse. Aggregates three signals:
//
//   • Readiness — below-goal weakest link (food/water days)
//   • Expiry    — items expiring in 1d / 30d / 60d windows
//   • Shopping  — to-buy and to-restock counts
//
// Tap opens the shared AlertsBellShell dropdown with one card per signal so
// the user gets the same rich preview that used to live as banners at the
// top of the boxes list.
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  getWarehouseById,
  listAllItemsInWarehouse,
  listHouseholdMembers,
  listShoppingList,
  subscribeChecklists,
  subscribeHousehold,
  subscribeShopping,
} from '@/src/lib/supabase';
import { computeReadiness } from '@/src/lib/readiness';
import { hasWaterFilterInStock } from '@/src/lib/kitCoverage';
import { warehouseTracksSupplies } from '@/src/lib/checklists';
import { daysUntil } from '@/src/types/database';
import { AlertsBellShell, delayedRoute, worstTone, type AlertTone } from './AlertsBellShell';
import { ExpiryAlertCard, pickExpiryTier } from './ExpiryAlertCard';
import { ReadinessCard } from './ReadinessCard';
import { ShoppingCard } from './ShoppingCard';

interface State {
  tones: AlertTone[];
  expiry: { d1: number; d30: number; d60: number };
}

export function WarehouseAlertsBell({
  warehouseId,
  actionsAfterBell = 2,
}: {
  warehouseId: string;
  /** Number of header action icons rendered to the right of the bell.
   *  Defaults to 2 (Boxes-tab layout). Pass the actual count for tabs that
   *  expose a different action set. */
  actionsAfterBell?: number;
}) {
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);

  const load = useCallback(async () => {
    if (!warehouseId) return;
    try {
      const [items, members, wh, shopping, tracks] = await Promise.all([
        listAllItemsInWarehouse(warehouseId),
        listHouseholdMembers(warehouseId),
        getWarehouseById(warehouseId),
        listShoppingList(warehouseId).catch(() => []),
        warehouseTracksSupplies(warehouseId).catch(() => true),
      ]);
      const goalDays = wh?.readiness_goal_days ?? 14;
      const result = computeReadiness(items, members, { hasWaterFilter: hasWaterFilterInStock(items) });
      const tones: AlertTone[] = [];

      // Readiness alert — only when the warehouse tracks supplies and the
      // weakest link falls below the goal. Non-supply warehouses (e.g. a
      // workshop kit) don't surface a survival-days alert.
      if (tracks && result.weakestLink) {
        const ratio = goalDays > 0 ? result.weakestLink.days / goalDays : 0;
        if (ratio < 1) tones.push(ratio >= 0.25 ? 'amber' : 'red');
      }

      // Expiry alert — count items in each window. Skips never-expires sentinel.
      let d1 = 0;
      let d30 = 0;
      let d60 = 0;
      for (const it of items) {
        if (!it.expiry_date || it.expiry_date === '9999-12-31') continue;
        try {
          const d = daysUntil(it.expiry_date);
          if (!Number.isFinite(d)) continue;
          if (d <= 1) d1++;
          if (d <= 30) d30++;
          if (d <= 60) d60++;
        } catch {
          /* malformed — skip */
        }
      }
      if (d1 > 0) tones.push('red');
      else if (d30 > 0) tones.push('amber');
      else if (d60 > 0) tones.push('sage');

      // Shopping alert.
      const toBuy = shopping.filter((i) => !i.checked).length;
      const toRestock = shopping.filter((i) => i.checked).length;
      if (toRestock > 0) tones.push('amber');
      else if (toBuy > 0) tones.push('sage');

      setState({ tones, expiry: { d1, d30, d60 } });
    } catch {
      /* non-fatal — bell stays hidden */
    }
  }, [warehouseId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Live-update the badge when a peer changes the shared signals on another
  // device (household members, shopping list, checklists). Item/expiry changes
  // are same-device and refresh on focus.
  useEffect(() => {
    if (!warehouseId) return;
    const unsubHh = subscribeHousehold(warehouseId, () => load());
    const unsubShop = subscribeShopping(warehouseId, () => load());
    const unsubKit = subscribeChecklists(warehouseId, () => load());
    return () => {
      unsubHh();
      unsubShop();
      unsubKit();
    };
  }, [warehouseId, load]);

  const tone = state && state.tones.length > 0 ? worstTone(state.tones) : null;
  const alertCount = state?.tones.length ?? 0;

  return (
    <AlertsBellShell
      tone={tone}
      alertCount={alertCount}
      actionsAfterBell={actionsAfterBell}
      renderPanel={(close) => (
        <>
          <ReadinessCard
            warehouseId={warehouseId}
            onPress={() =>
              delayedRoute(close, () => router.push(`/warehouse/${warehouseId}/readiness` as any))
            }
          />
          {state && pickExpiryTier(state.expiry) != null && (
            <ExpiryAlertCard
              counts={state.expiry}
              onPress={(tier) =>
                delayedRoute(close, () => router.push(`/alerts/${tier}` as any))
              }
            />
          )}
          <ShoppingCard
            warehouseId={warehouseId}
            onPress={() =>
              delayedRoute(close, () => router.push(`/warehouse/${warehouseId}/shopping` as any))
            }
          />
        </>
      )}
    />
  );
}
