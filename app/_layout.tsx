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
import { acceptInvitation, supabase } from '@/src/lib/supabase';
import { colors } from '@/src/theme';

// Stash key for an invitation token that arrived while the user was signed
// out. Consumed on the next successful auth state change.
const PENDING_INVITE_KEY = 'stockr:pendingInviteToken';

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
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
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      setSession(s);
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

  // --- Auth guard (routing podle session) ---
  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!session && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (session && inAuthGroup) {
      router.replace('/' as any);
    }
  }, [session, loading, segments]);

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
