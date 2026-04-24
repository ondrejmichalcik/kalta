// ============================================================================
// Kalta – (app) stack layout
// ============================================================================
import { useCallback } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { getActiveUserId } from '@/src/lib/supabase';
import { runSyncCycle } from '@/src/lib/sync';
import { SyncStatusBar } from '@/src/components/SyncStatusBar';
import { colors } from '@/src/theme';

export default function AppLayout() {
  // When the device comes back online, trigger a sync cycle.
  const handleReconnect = useCallback(async () => {
    const uid = await getActiveUserId();
    if (uid) runSyncCycle(uid).catch(() => {});
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack screenOptions={{ headerShown: false }} />
      <SyncStatusBar onReconnect={handleReconnect} />
    </View>
  );
}
