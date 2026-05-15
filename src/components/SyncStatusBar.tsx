// ============================================================================
// Kalta – Global sync status bar
// Sits at the bottom of the (app) layout. Shows current sync state:
// - hidden when fully synced & online
// - "Offline · X pending" when no network
// - "Syncing..." when sync cycle is running
// - "X conflicts to resolve" when unresolved conflicts exist (tappable)
// - "X pending changes" when online but un-pushed changes remain
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  getConflictCount,
  getPendingSyncCount,
  getSyncStatus,
  subscribeSyncStatus,
  type SyncStatus,
} from '@/src/lib/sync';
import { useSubscription } from '@/src/lib/subscription';
import { useNetworkStatus } from '@/src/lib/useNetworkStatus';
import { colors, radius, spacing, typography } from '@/src/theme';
import { Icon, type SFSymbolName } from './Icon';

type BarState =
  | { kind: 'hidden' }
  | { kind: 'lapsed' }
  | { kind: 'offline'; pending: number }
  | { kind: 'syncing' }
  | { kind: 'conflicts'; count: number }
  | { kind: 'pending'; count: number };

export function SyncStatusBar({ onReconnect }: { onReconnect?: () => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(getSyncStatus());
  const [pendingCount, setPendingCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);

  const isOnline = useNetworkStatus(onReconnect);
  const { status: subStatus } = useSubscription();

  // Subscribe to sync status changes
  useEffect(() => {
    return subscribeSyncStatus(setSyncStatus);
  }, []);

  // Refresh counts periodically and after sync status changes
  const refreshCounts = useCallback(() => {
    try {
      setPendingCount(getPendingSyncCount());
      setConflictCount(getConflictCount());
    } catch { /* db not ready */ }
  }, []);

  useEffect(() => {
    refreshCounts();
    const interval = setInterval(refreshCounts, 5_000);
    return () => clearInterval(interval);
  }, [refreshCounts, syncStatus]);

  // Determine what to show. Lapsed subscription takes the highest
  // priority — every local edit accumulates as "pending forever" until
  // the user renews, so it's the most actionable signal.
  const state: BarState = (() => {
    if (subStatus === 'lapsed') return { kind: 'lapsed' };
    if (syncStatus === 'syncing') return { kind: 'syncing' };
    if (!isOnline) return { kind: 'offline', pending: pendingCount };
    if (conflictCount > 0) return { kind: 'conflicts', count: conflictCount };
    if (pendingCount > 0) return { kind: 'pending', count: pendingCount };
    return { kind: 'hidden' };
  })();

  if (state.kind === 'hidden') return null;

  const config = BAR_CONFIG[state.kind];
  // Offline with pending counts also navigates so the user can review what
  // hasn't synced yet — same destination as the online "pending" state.
  const tappable =
    state.kind === 'lapsed' ||
    state.kind === 'conflicts' ||
    state.kind === 'pending' ||
    (state.kind === 'offline' && state.pending > 0);

  const onBarPress = () => {
    if (state.kind === 'lapsed') {
      router.push('/paywall?canDismiss=1' as any);
    } else if (state.kind === 'conflicts') {
      router.push('/conflicts' as any);
    } else if (state.kind === 'pending' || state.kind === 'offline') {
      router.push('/pending' as any);
    }
  };

  const label = (() => {
    switch (state.kind) {
      case 'lapsed':
        return 'Cloud sync off \u00B7 Renew to resume';
      case 'offline':
        return state.pending > 0
          ? `Offline \u00B7 ${state.pending} pending change${state.pending > 1 ? 's' : ''}`
          : 'Offline';
      case 'syncing':
        return 'Syncing\u2026';
      case 'conflicts':
        return `${state.count} sync conflict${state.count > 1 ? 's' : ''} to resolve`;
      case 'pending':
        return `${state.count} pending change${state.count > 1 ? 's' : ''}`;
    }
  })();

  return (
    <Pressable
      style={({ pressed }) => [
        styles.bar,
        { backgroundColor: config.bg, paddingBottom: Math.max(insets.bottom, spacing.xs) },
        tappable && pressed && { opacity: 0.7 },
      ]}
      onPress={tappable ? onBarPress : undefined}
      disabled={!tappable}
    >
      {state.kind === 'syncing' ? (
        <ActivityIndicator size="small" color={config.fg} />
      ) : (
        <Icon sf={config.icon} size={14} color={config.fg} />
      )}
      <Text style={[styles.label, { color: config.fg }]}>{label}</Text>
      {tappable && <Icon sf="chevron.right" size={11} color={config.fg} />}
    </Pressable>
  );
}

const BAR_CONFIG: Record<Exclude<BarState['kind'], 'hidden'>, { bg: string; fg: string; icon: SFSymbolName }> = {
  lapsed: {
    bg: colors.warningBg,
    fg: colors.warningText,
    icon: 'arrow.clockwise.circle.fill',
  },
  offline: {
    bg: colors.palette.neutral[200],
    fg: colors.textMuted,
    icon: 'wifi.slash',
  },
  syncing: {
    bg: colors.primaryTint,
    fg: colors.primary,
    icon: 'arrow.triangle.2.circlepath',
  },
  conflicts: {
    bg: colors.warningBg,
    fg: colors.warningText,
    icon: 'exclamationmark.triangle.fill',
  },
  pending: {
    bg: colors.primaryTint,
    fg: colors.primary,
    icon: 'arrow.triangle.2.circlepath',
  },
};

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xs + 2,
    paddingHorizontal: spacing.md,
  },
  label: {
    ...typography.caption,
    fontWeight: '600',
  },
});
