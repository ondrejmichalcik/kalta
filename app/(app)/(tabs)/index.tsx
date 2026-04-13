// ============================================================================
// Stockr – Boxes tab (the list of all boxes in the current warehouse)
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  ensureWarehouse,
  listBoxes,
  subscribeBoxes,
  supabase,
} from '@/src/lib/supabase';
import type { Box, Warehouse } from '@/src/types/database';
import {
  compareBoxesByExpiry,
  formatExpiry,
  getExpiryStatus,
  EXPIRY_COLORS,
} from '@/src/types/database';
import { colors, radius, spacing, typography } from '@/src/theme';
import { Card } from '@/src/components/Card';
import { FAB } from '@/src/components/FAB';
import { Icon } from '@/src/components/Icon';
import { ListHeader } from '@/src/components/ListHeader';
import { StatusDot } from '@/src/components/StatusDot';

// Height of the bottom tab bar (iOS native) + safe space for the FAB.
const TAB_BAR_HEIGHT = 84;

export default function BoxesScreen() {
  const router = useRouter();
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess.session?.user.id;
      if (!userId) return;
      const wh = await ensureWarehouse(userId);
      setWarehouse(wh);
      const rows = await listBoxes(wh.id);
      setBoxes(rows);
    } catch (e: any) {
      setError(e?.message ?? 'Cannot load warehouse.');
      throw e;
    }
  }, []);

  const retry = async () => {
    setLoading(true);
    try {
      await load();
    } catch {
      /* error is in state */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load]),
  );

  useEffect(() => {
    if (!warehouse) return;
    const unsubscribe = subscribeBoxes(warehouse.id, () => {
      listBoxes(warehouse.id).then(setBoxes).catch(() => {});
    });
    return unsubscribe;
  }, [warehouse]);

  const sortedBoxes = useMemo(() => [...boxes].sort(compareBoxesByExpiry), [boxes]);

  const criticalCount = useMemo(
    () =>
      boxes.filter((b) => {
        const s = getExpiryStatus(b.nearest_expiry);
        return s === 'critical' || s === 'expired';
      }).length,
    [boxes],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } catch {
      /* error is in state */
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error && boxes.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Icon brand="warning" size={96} style={styles.errorIcon} />
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={retry}>
            <Icon sf="arrow.clockwise" size={18} color={colors.textOnPrimary} />
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ListHeader
        title="Boxes"
        actions={[
          { sfIcon: 'magnifyingglass', onPress: () => {}, label: 'Search' },
          { sfIcon: 'line.3.horizontal.decrease', onPress: () => {}, label: 'Filter' },
        ]}
      />

      {criticalCount > 0 && (
        <View style={styles.alertBanner}>
          <Icon sf="exclamationmark.triangle.fill" size={18} color={colors.danger} />
          <Text style={styles.alertText}>
            {criticalCount} {criticalCount === 1 ? 'box has' : 'boxes have'} critical expiry
          </Text>
        </View>
      )}

      <FlatList
        data={sortedBoxes}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.textMuted}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon brand="box-generic" size={120} style={styles.emptyIcon} />
            <Text style={styles.emptyTitle}>No boxes yet</Text>
            <Text style={styles.emptyText}>
              Create your first box and stick a QR label on it.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <BoxRow box={item} onPress={() => router.push(`/box/${item.id}` as any)} />
        )}
      />

      <FAB
        label="New box"
        sfIcon="plus"
        bottom={TAB_BAR_HEIGHT + 12}
        onPress={() => router.push('/box/new' as any)}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// BoxRow
// ---------------------------------------------------------------------------

function BoxRow({ box, onPress }: { box: Box; onPress: () => void }) {
  const status = getExpiryStatus(box.nearest_expiry);
  const palette =
    status === 'none'
      ? { bg: colors.expiryNoneBg, fg: colors.expiryNoneText }
      : EXPIRY_COLORS[status];

  const itemCountText = `${box.item_count} ${box.item_count === 1 ? 'item' : 'items'}`;
  const subtitleParts = [box.location, itemCountText].filter(Boolean);

  return (
    <Card onPress={onPress} style={styles.card}>
      <StatusDot status={status} />
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {box.name}
        </Text>
        <Text style={styles.cardSubtitle} numberOfLines={1}>
          {subtitleParts.join(' · ')}
        </Text>
      </View>
      <View style={[styles.badge, { backgroundColor: palette.bg }]}>
        <Text style={[styles.badgeText, { color: palette.fg }]} numberOfLines={1}>
          {formatExpiry(box.nearest_expiry)}
        </Text>
      </View>
      <Icon sf="chevron.right" size={14} color={colors.textSubtle} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
  },
  errorIcon: { marginBottom: spacing.lg },
  errorTitle: {
    ...typography.title3,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  errorText: {
    ...typography.subhead,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.full,
  },
  retryText: {
    ...typography.bodyStrong,
    color: colors.textOnPrimary,
  },

  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    backgroundColor: colors.dangerBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.dangerBgStrong,
  },
  alertText: {
    ...typography.footnote,
    color: colors.dangerText,
    fontWeight: '600',
    flex: 1,
  },

  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: TAB_BAR_HEIGHT + 80,
    gap: spacing.sm + 2,
  },

  card: {
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md + 2,
  },
  cardBody: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    ...typography.headline,
    color: colors.text,
  },
  cardSubtitle: {
    ...typography.footnote,
    color: colors.textMuted,
  },
  badge: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.full,
    maxWidth: 110,
  },
  badgeText: {
    ...typography.caption,
    fontWeight: '700',
  },

  empty: {
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: spacing.xxl,
  },
  emptyIcon: { marginBottom: spacing.lg },
  emptyTitle: {
    ...typography.title2,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyText: {
    ...typography.subhead,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
