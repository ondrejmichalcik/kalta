// ============================================================================
// Stockr – root layout
// Auth guard + deep link handler pro stockr://invite/TOKEN
// ============================================================================
import 'react-native-gesture-handler';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, Alert, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import type { Session } from '@supabase/supabase-js';
import { acceptInvitation, listAllItemsInWarehouse, getMyWarehouses, supabase } from '@/src/lib/supabase';
import * as Notifications from 'expo-notifications';
import { rescheduleExpiryNotifications, setupForegroundHandler } from '@/src/lib/notifications';
import { initLocalDb } from '@/src/lib/localDb';
import { hasInitialSync, initialFullSync, runSyncCycle, getPendingSyncCount } from '@/src/lib/sync';
import { initImageCache, cleanupOrphanedCache } from '@/src/lib/imageCache';
import { colors } from '@/src/theme';

// Show notifications even when app is in foreground.
setupForegroundHandler();

// Initialize local SQLite database on module load (sync, no async needed).
initLocalDb();

// Build in-memory image cache map from disk, then clean up orphans.
initImageCache()
  .then(() => cleanupOrphanedCache())
  .catch(() => {});

// Stash key for an invitation token that arrived while the user was signed
// out. Consumed on the next successful auth state change.
const PENDING_INVITE_KEY = 'stockr:pendingInviteToken';
const CACHED_USER_KEY = 'stockr:cachedUser';
// Last known user — NOT cleared on sign out, used for offline recovery
const LAST_USER_KEY = 'stockr:lastUser';

/** Minimal user identity cached in AsyncStorage for offline auth bypass. */
interface CachedUser {
  id: string;
  email: string | null;
}

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  // Cached user identity — survives token expiry when offline.
  const [cachedUser, setCachedUser] = useState<CachedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const segments = useSegments();
  // Guards against double-processing the same pending invite when auth
  // state changes multiple times in quick succession (e.g. SIGNED_IN + TOKEN_REFRESHED).
  const processingPendingRef = useRef(false);

  // Redeem a token, show an alert, navigate home. Shared between the deep
  // link handler and the post-login pending-invite consumer.
  const processInvite = useCallback(
    async (token: string, userId: string) => {
      try {
        await acceptInvitation(token, userId);
        await AsyncStorage.removeItem(PENDING_INVITE_KEY);
        Alert.alert('Done', 'Invitation accepted. Welcome to the shared warehouse!');
        router.replace('/' as any);
      } catch (e: any) {
        // Discard the pending token on error — it's either expired, already
        // used, or malformed. No point keeping it around to fail again.
        await AsyncStorage.removeItem(PENDING_INVITE_KEY);
        Alert.alert('Invitation error', e?.message ?? 'Unknown error');
      }
    },
    [router],
  );

  // --- Session boot ---
  useEffect(() => {
    (async () => {
      // Load cached user identity first (sync, from AsyncStorage)
      const raw = await AsyncStorage.getItem(CACHED_USER_KEY);
      const cached: CachedUser | null = raw ? JSON.parse(raw) : null;
      if (cached) setCachedUser(cached);

      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setSession(data.session);
        // Persist identity for offline use
        const user: CachedUser = {
          id: data.session.user.id,
          email: data.session.user.email ?? null,
        };
        setCachedUser(user);
        AsyncStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
        AsyncStorage.setItem(LAST_USER_KEY, JSON.stringify(user));
      }
      // If getSession returned null but we have a cached user, we're offline
      // with an expired token — don't clear session, let the app work locally.
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      setSession(s);
      if (s) {
        // Persist identity on every auth state change
        const user: CachedUser = { id: s.user.id, email: s.user.email ?? null };
        setCachedUser(user);
        AsyncStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
        AsyncStorage.setItem(LAST_USER_KEY, JSON.stringify(user));
      }
      // If we just gained a session and a pending invite is stashed, redeem it.
      if (s && !processingPendingRef.current) {
        const pending = await AsyncStorage.getItem(PENDING_INVITE_KEY);
        if (pending) {
          processingPendingRef.current = true;
          await processInvite(pending, s.user.id);
          processingPendingRef.current = false;
        }
      }
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, [processInvite]);

  // --- Initial sync + notifications on session available ---
  // Use session.user.id when online, fall back to cachedUser.id when offline.
  const activeUserId = session?.user.id ?? cachedUser?.id ?? null;

  useEffect(() => {
    if (!activeUserId) return;
    (async () => {
      try {
        const uid = activeUserId;

        // Run initial full sync if this is the first launch (or after
        // DB reset). Downloads all Supabase data into local SQLite.
        // Subsequent reads go to SQLite → instant + offline-capable.
        if (!hasInitialSync()) {
          await initialFullSync(uid);
        }

        // Run background sync cycle (push local changes, pull remote updates).
        // Fire-and-forget — sync errors don't block app startup.
        runSyncCycle(uid).catch(() => {});

        // Reschedule expiry notifications from local data.
        const warehouses = await getMyWarehouses(uid);
        const allItems: { id: string; name: string; expiry_date: string | null; box_id: string; box_name?: string; warehouse_id?: string }[] = [];
        for (const wh of warehouses) {
          const items = await listAllItemsInWarehouse(wh.id);
          allItems.push(...items.map((i) => ({ ...i, box_name: i.box_name, warehouse_id: wh.id })));
        }
        await rescheduleExpiryNotifications(allItems);
      } catch {
        // Non-fatal — app works with Supabase fallback if sync fails.
      }
    })();
  }, [activeUserId]);

  // --- Auth guard (routing podle session) ---
  // Allow app access when we have a valid session OR a cached user identity
  // (offline with expired token — user is still "logged in" for local ops).
  const isAuthenticated = !!(session || cachedUser);

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/' as any);
    }
  }, [isAuthenticated, loading, segments]);

  // --- Deep link handler: stockr://invite/TOKEN ---
  useEffect(() => {
    const handle = async (url: string | null) => {
      if (!url) return;
      const parsed = Linking.parse(url);
      const path = parsed.path ?? '';
      const match = path.match(/^invite\/(.+)$/);
      if (!match) return;
      const token = match[1];

      const s = (await supabase.auth.getSession()).data.session;
      if (!s) {
        // Persist token for post-login processing. The onAuthStateChange
        // handler above will pick it up once the user signs in.
        await AsyncStorage.setItem(PENDING_INVITE_KEY, token);
        Alert.alert(
          'Invitation',
          'Sign in to accept this invitation. We\'ll remember the link for you.',
        );
        return;
      }
      await processInvite(token, s.user.id);
    };

    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, [processInvite]);

  // --- Notification tap → navigate to box detail ---
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as {
        boxId?: string;
        warehouseId?: string;
      } | undefined;
      if (data?.warehouseId && data?.boxId) {
        router.push(`/warehouse/${data.warehouseId}/box/${data.boxId}` as any);
      }
    });
    return () => sub.remove();
  }, [router]);

  if (loading) {
    return (
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: colors.background,
          }}
        >
          <ActivityIndicator color={colors.primary} />
        </View>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style="dark" />
      {/* Login overrides to light via its own <StatusBar> in (auth)/login.tsx */}
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
      </Stack>
    </GestureHandlerRootView>
  );
}
