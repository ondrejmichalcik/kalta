// ============================================================================
// Kalta – (app) stack layout
// ============================================================================
import { useCallback, useEffect } from 'react';
import { AppState, View } from 'react-native';
import { Stack } from 'expo-router';
import { getActiveUserId } from '@/src/lib/supabase';
import { runSyncCycle } from '@/src/lib/sync';
import { scheduleRemotePull } from '@/src/lib/syncBus';
import { SyncStatusBar } from '@/src/components/SyncStatusBar';
import { colors } from '@/src/theme';

export default function AppLayout() {
  // When the device comes back online, trigger a sync cycle.
  const handleReconnect = useCallback(async () => {
    const uid = await getActiveUserId();
    if (uid) runSyncCycle(uid).catch(() => {});
  }, []);

  // Backstop sync so a partner's changes converge even if a realtime event was
  // missed (flaky socket, app backgrounded during the change): pull on every
  // foreground and on a slow interval while the app is active. A successful
  // pull fires onDataChanged, which reloads the mounted dashboards.
  useEffect(() => {
    const pull = () => {
      getActiveUserId().then((uid) => {
        if (uid) scheduleRemotePull(uid);
      });
    };
    pull(); // on mount
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') pull();
    });
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') pull();
    }, 20_000);
    return () => {
      sub.remove();
      clearInterval(interval);
    };
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack screenOptions={{ headerShown: false }} />
      <SyncStatusBar onReconnect={handleReconnect} />
    </View>
  );
}
