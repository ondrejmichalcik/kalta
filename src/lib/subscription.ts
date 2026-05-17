import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  deepLinkToSubscriptions,
  fetchProducts,
  finishTransaction,
  getActiveSubscriptions,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  restorePurchases as iapRestorePurchases,
  type ProductSubscription,
} from 'expo-iap';
// Note: `supabase` is intentionally NOT imported statically. Several
// callers (sync.ts, storage.ts, vision.ts) pull `subscription.ts` in,
// and one of those (sync.ts) is in turn imported by supabase.ts —
// closing a cycle that left `supabase` as `undefined` here on cold
// start and deadlocked auth.getSession() for minutes. The single push
// path uses a lazy require instead.

// Master gate for the entire subscription feature. While false, the app
// behaves as it did before subscriptions existed: `useSubscription` returns
// `active` without ever touching StoreKit, every gate passes, and the
// paywall flow is unreachable. Flip to true once the ASC product exists
// and TestFlight sandbox testing is wired up.
export const SUBSCRIPTION_ENFORCEMENT_ENABLED = false;

export const SUBSCRIPTION_PRODUCT_ID = 'com.ondrejmichalcik.kalta.cloud_yearly';

const CACHE_KEY = '@kalta/subscription_state';

export type SubscriptionStatus =
  | 'loading'
  | 'active'
  | 'lapsed'
  | 'never';

export interface SubscriptionState {
  status: SubscriptionStatus;
  expiresAt: Date | null;
  productId: string | null;
}

const OPEN_ACCESS_STATE: SubscriptionState = {
  status: 'active',
  expiresAt: null,
  productId: null,
};

export function canEnterApp(state: SubscriptionState): boolean {
  return state.status === 'active' || state.status === 'lapsed';
}

export function isCloudEnabled(state: SubscriptionState): boolean {
  return state.status === 'active';
}

interface CachedState {
  status: SubscriptionStatus;
  expiresAt: string | null;
  productId: string | null;
  cachedAt: number;
}

async function loadCachedState(): Promise<SubscriptionState | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedState;
    return {
      status: parsed.status,
      expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
      productId: parsed.productId,
    };
  } catch {
    return null;
  }
}

async function saveCachedState(state: SubscriptionState): Promise<void> {
  try {
    const payload: CachedState = {
      status: state.status,
      expiresAt: state.expiresAt?.toISOString() ?? null,
      productId: state.productId,
      cachedAt: Date.now(),
    };
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Non-fatal — next launch will re-fetch from StoreKit anyway.
  }
}

// Module-level singleton: initConnection is idempotent in expo-iap but
// surfacing extra warnings on duplicate calls is annoying. Track once.
let connectionPromise: Promise<boolean> | null = null;

// In-memory mirror of the latest known SubscriptionState. The hook keeps
// this fresh; non-React callers (sync engine, image upload, vision API)
// read it via `getSubscriptionStateNow()` without waiting on AsyncStorage.
let memoState: SubscriptionState | null = null;

// Kick off an eager hydrate so that the first sync cycle at app boot
// already has a real answer (rather than defaulting to "loading" and
// either over- or under-gating cloud calls).
loadCachedState().then((cached) => {
  if (cached) memoState = cached;
});

/**
 * Synchronous read of the latest known subscription state. Returns
 * OPEN_ACCESS_STATE when enforcement is off; falls back to a loading
 * placeholder until the first hydrate completes (rare race window).
 */
export function getSubscriptionStateNow(): SubscriptionState {
  if (!SUBSCRIPTION_ENFORCEMENT_ENABLED) return OPEN_ACCESS_STATE;
  return memoState ?? { status: 'loading', expiresAt: null, productId: null };
}

/**
 * True when cloud-touching operations (Supabase sync push, image upload,
 * AI vision) should be allowed. Use this from sync engine / storage /
 * vision modules; React components should read `useSubscription()`.
 */
export function isCloudEnabledNow(): boolean {
  return isCloudEnabled(getSubscriptionStateNow());
}

/**
 * Thrown by cloud-only library functions (image upload, AI vision) when
 * the user has no active subscription. UI catches this and shows a
 * "Subscribe to unlock" prompt instead of a generic failure.
 */
export class CloudFeatureDisabledError extends Error {
  feature: string;
  constructor(feature: string) {
    super(`Cloud feature unavailable: ${feature}. Active subscription required.`);
    this.name = 'CloudFeatureDisabledError';
    this.feature = feature;
  }
}

function ensureConnection(): Promise<boolean> {
  if (!connectionPromise) {
    connectionPromise = initConnection().catch((err) => {
      console.warn('[subscription] initConnection failed', err);
      connectionPromise = null;
      return false;
    });
  }
  return connectionPromise;
}

async function queryStoreKitState(): Promise<SubscriptionState> {
  const ok = await ensureConnection();
  if (!ok) {
    return { status: 'never', expiresAt: null, productId: null };
  }

  const active = await getActiveSubscriptions([SUBSCRIPTION_PRODUCT_ID]);
  if (active.length > 0) {
    const sub = active[0] as any;
    const rawExp = sub.expirationDateIOS ?? sub.expirationDate ?? null;
    const expiresAt = rawExp ? new Date(rawExp) : null;
    return {
      status: 'active',
      expiresAt,
      productId: sub.productId ?? SUBSCRIPTION_PRODUCT_ID,
    };
  }

  // Not active — check whether the user EVER held this subscription.
  // `Transaction.all` (via onlyIncludeActiveItemsIOS: false) is what
  // separates `lapsed` from `never`.
  const history = await getAvailablePurchases({
    onlyIncludeActiveItemsIOS: false,
  } as any);
  const hadSubscription = history.some(
    (p) => p.productId === SUBSCRIPTION_PRODUCT_ID,
  );
  return hadSubscription
    ? { status: 'lapsed', expiresAt: null, productId: SUBSCRIPTION_PRODUCT_ID }
    : { status: 'never', expiresAt: null, productId: null };
}

export async function purchaseSubscription(): Promise<void> {
  if (!SUBSCRIPTION_ENFORCEMENT_ENABLED) {
    throw new Error('Subscription enforcement is disabled');
  }
  if (Platform.OS !== 'ios') {
    throw new Error('Subscriptions are only supported on iOS');
  }
  await ensureConnection();
  await requestPurchase({
    request: { ios: { sku: SUBSCRIPTION_PRODUCT_ID } },
    type: 'subs',
  } as any);
}

export async function restoreSubscription(): Promise<void> {
  if (!SUBSCRIPTION_ENFORCEMENT_ENABLED) return;
  await ensureConnection();
  await iapRestorePurchases();
}

export async function openManageSubscriptions(): Promise<void> {
  await deepLinkToSubscriptions({} as any);
}

/**
 * Mirror the current StoreKit-derived subscription expiry to the
 * `public.users` row in Supabase. The server-side `cleanup_lapsed_cloud_data`
 * cron reads this column to decide which warehouses to GC after 30 days
 * of lapse. We skip 'never' (nothing useful to record) and 'loading'.
 */
async function pushSubscriptionToSupabase(state: SubscriptionState): Promise<void> {
  if (state.status === 'never' || state.status === 'loading') return;
  // Lazy require — see the comment near the file-top imports.
  const { supabase } = require('./supabase') as typeof import('./supabase');
  const { data } = await supabase.auth.getUser();
  const userId = data?.user?.id;
  if (!userId) return; // not signed in — nothing to update yet
  await supabase
    .from('users')
    .update({
      subscription_expires_at: state.expiresAt?.toISOString() ?? null,
      subscription_product_id: state.productId,
    })
    .eq('id', userId);
}

export async function fetchSubscriptionProduct(): Promise<ProductSubscription | null> {
  if (!SUBSCRIPTION_ENFORCEMENT_ENABLED) return null;
  await ensureConnection();
  const products = await fetchProducts({
    skus: [SUBSCRIPTION_PRODUCT_ID],
    type: 'subs',
  });
  const list = (products as ProductSubscription[]) ?? [];
  return list.find((p) => p.id === SUBSCRIPTION_PRODUCT_ID) ?? list[0] ?? null;
}

export interface UseSubscriptionResult extends SubscriptionState {
  refresh: () => Promise<void>;
}

export function useSubscription(): UseSubscriptionResult {
  const [state, setState] = useState<SubscriptionState>(() =>
    SUBSCRIPTION_ENFORCEMENT_ENABLED
      ? { status: 'loading', expiresAt: null, productId: null }
      : OPEN_ACCESS_STATE,
  );
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!SUBSCRIPTION_ENFORCEMENT_ENABLED) {
      memoState = OPEN_ACCESS_STATE;
      if (mountedRef.current) setState(OPEN_ACCESS_STATE);
      return;
    }
    try {
      const next = await queryStoreKitState();
      memoState = next;
      if (!mountedRef.current) return;
      setState(next);
      await saveCachedState(next);
      // Fire-and-forget push to Supabase so the server-side 30-day TTL
      // cleanup can see when this user's sub lapses. Failure is non-fatal
      // (will retry on next refresh).
      pushSubscriptionToSupabase(next).catch(() => {});
    } catch (err) {
      console.warn('[subscription] refresh failed', err);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!SUBSCRIPTION_ENFORCEMENT_ENABLED) {
      return () => {
        mountedRef.current = false;
      };
    }

    const sub1 = purchaseUpdatedListener(async (purchase) => {
      // StoreKit will replay unfinished transactions on launch; mark each
      // one finished so it doesn't keep firing. The actual entitlement
      // state we read separately via `getActiveSubscriptions`.
      try {
        await finishTransaction({ purchase, isConsumable: false });
      } catch (err) {
        console.warn('[subscription] finishTransaction failed', err);
      }
      if (mountedRef.current) refresh();
    });

    const sub2 = purchaseErrorListener((err) => {
      console.warn('[subscription] purchase error', err);
    });

    // Hydrate from cache first for instant offline first-paint, then
    // refresh from StoreKit in the background.
    loadCachedState().then((cached) => {
      if (cached) {
        memoState = cached;
        if (mountedRef.current) setState(cached);
      }
      refresh();
    });

    return () => {
      mountedRef.current = false;
      sub1.remove();
      sub2.remove();
    };
  }, [refresh]);

  return { ...state, refresh };
}