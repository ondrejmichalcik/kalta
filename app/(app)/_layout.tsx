// ============================================================================
// Stockr – (app) stack layout
// ============================================================================
import { useCallback } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { runSyncCycle } from '@/src/lib/sync';
import { SyncStatusBar } from '@/src/components/SyncStatusBar';
import { colors } from '@/src/theme';

export default function AppLayout() {
  // When the device comes back online, trigger a sync cycle.
  const handleReconnect = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    if (uid) runSyncCycle(uid).catch(() => {});
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack screenOptions={{ headerShown: false }} />
      <SyncStatusBar onReconnect={handleReconnect} />
    </View>
  );
}
