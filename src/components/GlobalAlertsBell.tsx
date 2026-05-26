// ============================================================================
// Kalta – GlobalAlertsBell
// Cross-warehouse expiry indicator on the Warehouses root header. Aggregates
// items in ≤1 / ≤30 / ≤60 day windows across every warehouse the user can
// see and exposes the most urgent tier as a card inside the AlertsBellShell
// dropdown. Replaces the inline 3-tier banner that used to sit above the
// warehouses list.
// ============================================================================
import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { getActiveUserId, getMyWarehouses, listAllItemsInWarehouse } from '@/src/lib/supabase';
import { daysUntil } from '@/src/types/database';
import { AlertsBellShell, delayedRoute, type AlertTone } from './AlertsBellShell';
import { ExpiryAlertCard, pickExpiryTier } from './ExpiryAlertCard';

interface Counts {
  d1: number;
  d30: number;
  d60: number;
}

export function GlobalAlertsBell({
  actionsAfterBell = 1,
}: {
  actionsAfterBell?: number;
}) {
  const router = useRouter();
  const [counts, setCounts] = useState<Counts | null>(null);

  const load = useCallback(async () => {
    try {
      const uid = await getActiveUserId();
      if (!uid) return;
      const list = await getMyWarehouses(uid);
      let d1 = 0;
      let d30 = 0;
      let d60 = 0;
      for (const wh of list) {
        try {
          const items = await listAllItemsInWarehouse(wh.id);
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
        } catch {
          /* offline / db-not-ready — skip */
        }
      }
      setCounts({ d1, d30, d60 });
    } catch {
      /* non-fatal — bell stays hidden */
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const tier = counts ? pickExpiryTier(counts) : null;
  // Tone follows the worst non-zero tier the same way the old inline banner did.
  let tone: AlertTone | null = null;
  if (tier === 1) tone = 'red';
  else if (tier === 30) tone = 'amber';
  else if (tier === 60) tone = 'sage';

  return (
    <AlertsBellShell
      tone={tone}
      alertCount={tier == null ? 0 : 1}
      actionsAfterBell={actionsAfterBell}
      renderPanel={(close) =>
        counts ? (
          <ExpiryAlertCard
            counts={counts}
            onPress={(t) => delayedRoute(close, () => router.push(`/alerts/${t}` as any))}
          />
        ) : null
      }
    />
  );
}
