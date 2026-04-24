// ============================================================================
// Kalta – Invite deep link route
// Matches kalta://invite/TOKEN. Processes the invitation directly here
// instead of relying on the Linking handler in _layout.tsx.
// ============================================================================
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { acceptInvitation, supabase } from '@/src/lib/supabase';
import { colors } from '@/src/theme';

export default function InviteScreen() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();
  const processingRef = useRef(false);

  useEffect(() => {
    if (!token || processingRef.current) return;
    processingRef.current = true;

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          Alert.alert('Sign in first', 'Sign in to accept this invitation.');
          router.replace('/(auth)/login' as any);
          return;
        }

        await acceptInvitation(token, data.session.user.id);
        Alert.alert('Done', 'Invitation accepted. Welcome to the shared warehouse!');
        router.replace('/' as any);
      } catch (e: any) {
        Alert.alert('Invitation error', e?.message ?? 'Unknown error');
        router.replace('/' as any);
      }
    })();
  }, [token, router]);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}
