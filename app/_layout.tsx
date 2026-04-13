// ============================================================================
// Stockr – root layout
// Auth guard + deep link handler pro stockr://invite/TOKEN
// ============================================================================
import 'react-native-gesture-handler';
import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Alert, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/src/lib/supabase';
import { acceptInvitation } from '@/src/lib/supabase';
import { colors } from '@/src/theme';

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const segments = useSegments();

  // --- Session boot ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

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
      // Expo Linking: path např. "invite/abc-token"
      const path = parsed.path ?? '';
      const match = path.match(/^invite\/(.+)$/);
      if (!match) return;
      const token = match[1];

      const s = (await supabase.auth.getSession()).data.session;
      if (!s) {
        // If we're not signed in, we could stash the token in SecureStore and
        // apply it after login. For now just warn the user.
        Alert.alert('Invitation', 'Please sign in and open the link again.');
        return;
      }
      try {
        await acceptInvitation(token, s.user.id);
        Alert.alert('Done', 'Invitation accepted. Welcome to the shared warehouse!');
        router.replace('/' as any);
      } catch (e: any) {
        Alert.alert('Invitation error', e?.message ?? 'Unknown error');
      }
    };

    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, []);

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
