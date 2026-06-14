// ============================================================================
// Kalta – Invite deep link route
// Matches kalta://invite/TOKEN. Processes the invitation directly here
// instead of relying on the Linking handler in _layout.tsx.
// ============================================================================
import { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { acceptInvitation, supabase } from '@/src/lib/supabase';
import { toast } from '@/src/lib/feedback';
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
          toast.info('Sign in to accept this invitation.');
          router.replace('/(auth)/login' as any);
          return;
        }

        await acceptInvitation(token, data.session.user.id);
        toast.success('Invitation accepted. Welcome to the shared warehouse!');
        router.replace('/' as any);
      } catch (e: any) {
        toast.error(e?.message ?? 'Unknown error');
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
