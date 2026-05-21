// ============================================================================
// Kalta – Boxes tab (the list of all boxes in the current warehouse)
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { listBoxes, subscribeBoxes } from '@/src/lib/supabase';
import type { Box } from '@/src/types/database';
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
import { ResourceIcon } from '@/src/components/ResourceIcon';
import { ListHeader } from '@/src/components/ListHeader';
import { StatusDot } from '@/src/components/StatusDot';
import { ReadinessCard } from '@/src/components/ReadinessCard';
import {
  ActiveFilterChips,
  FilterSheet,
  matchesExpiryFilter,
  type StatusFilter,
} from '@/src/components/FilterSheet';

// Height of the bottom tab bar (iOS native) + safe space for the FAB.
const TAB_BAR_HEIGHT = 84;

export default function BoxesScreen() {
  const router = useRouter();
  const { warehouseId } = useLocalSearchParams<{ warehouseId: string }>();
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search + Filter
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);
  const searchRef = useRef<TextInput>(null);

  const load = useCallback(async () => {
    if (!warehouseId) return;
    try {
      setError(null);
      const rows = await listBoxes(warehouseId);
      setBoxes(rows);
    } catch (e: any) {
      setError(e?.message ?? 'Cannot load warehouse.');
      throw e;
    }
  }, [warehouseId]);

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
    if (!warehouseId) return;
    const unsubscribe = subscribeBoxes(warehouseId, () => {
      listBoxes(warehouseId).then(setBoxes).catch(() => {});
    });
    return unsubscribe;
  }, [warehouseId]);

  const sortedBoxes = useMemo(() => [...boxes].sort(compareBoxesByExpiry), [boxes]);

  const filteredBoxes = useMemo(() => {
    let result = sortedBoxes;
    // Text search — name + location, case-insensitive
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          (b.location && b.location.toLowerCase().includes(q)),
      );
    }
    // Status filter — boxes use nearest_expiry (min over their items).
    if (statusFilter !== 'all') {
      result = result.filter((b) => matchesExpiryFilter(b.nearest_expiry, statusFilter));
    }
    return result;
  }, [sortedBoxes, searchQuery, statusFilter]);

  const criticalCount = useMemo(
    () =>
      boxes.filter((b) => {
        const s = getExpiryStatus(b.nearest_expiry);
        return s === 'critical' || s === 'expired';
      }).length,
    [boxes],
  );

  const toggleSearch = () => {
    if (searchVisible) {
      setSearchQuery('');
      setSearchVisible(false);
    } else {
      setSearchVisible(true);
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  };

  const activeFilterCount = statusFilter !== 'all' ? 1 : 0;

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
        leading={
          <Pressable
            hitSlop={12}
            onPress={() => router.push('/' as any)}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.5 }]}
            accessibilityLabel="Back to warehouses"
          >
            <Icon sf="chevron.left" size={22} color={colors.text} />
          </Pressable>
        }
        actions={[
          {
            sfIcon: searchVisible ? 'xmark' : 'magnifyingglass',
            onPress: toggleSearch,
            label: searchVisible ? 'Close search' : 'Search',
          },
          {
            sfIcon: 'line.3.horizontal.decrease',
            onPress: () => setFilterSheetVisible(true),
            label: 'Filter',
            badge: activeFilterCount || undefined,
            active: activeFilterCount > 0,
          },
        ]}
      />

      {/* Search bar */}
      {searchVisible && (
        <View style={styles.searchBar}>
          <Icon sf="magnifyingglass" size={16} color={colors.textMuted} />
          <TextInput
            ref={searchRef}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search by name or location..."
            placeholderTextColor={colors.textSubtle}
            style={styles.searchInput}
            autoCorrect={false}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <Pressable hitSlop={8} onPress={() => setSearchQuery('')}>
              <Icon sf="xmark.circle.fill" size={18} color={colors.textMuted} />
            </Pressable>
          )}
        </View>
      )}

      {/* Active filter chips — tap × to clear without opening the sheet. */}
      <ActiveFilterChips
        status={statusFilter}
        condition={[]}
        category={[]}
        onClearStatus={() => setStatusFilter('all')}
        onClearCondition={() => {}}
        onClearCategory={() => {}}
      />

      {!searchVisible && <ReadinessCard warehouseId={warehouseId} />}

      {criticalCount > 0 && statusFilter === 'all' && !searchVisible && (
        <View style={styles.alertBanner}>
          <Icon sf="exclamationmark.triangle.fill" size={18} color={colors.danger} />
          <Text style={styles.alertText}>
            {criticalCount} {criticalCount === 1 ? 'box has' : 'boxes have'} critical expiry
          </Text>
        </View>
      )}

      <FlatList
        data={filteredBoxes}
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
            <Text style={styles.emptyTitle}>
              {searchQuery || statusFilter !== 'all' ? 'No matches' : 'No boxes yet'}
            </Text>
            <Text style={styles.emptyText}>
              {searchQuery || statusFilter !== 'all'
                ? 'Try a different search or filter.'
                : 'Create your first box and stick a QR label on it.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <BoxRow
            box={item}
            onPress={() => router.push(`/warehouse/${warehouseId}/box/${item.id}` as any)}
          />
        )}
      />

      <FAB
        label="New box"
        sfIcon="plus"
        bottom={TAB_BAR_HEIGHT + 12}
        onPress={() => router.push(`/warehouse/${warehouseId}/box/new` as any)}
      />

      <FilterSheet
        visible={filterSheetVisible}
        initial={{ status: statusFilter, condition: [], category: [] }}
        sections={['status']}
        onClose={() => setFilterSheetVisible(false)}
        onApply={({ status }) => {
          setStatusFilter(status);
          setFilterSheetVisible(false);
        }}
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
      <ResourceIcon table="boxes" size={32} />
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
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm + 2,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    ...typography.body,
    flex: 1,
    color: colors.text,
    paddingVertical: 0,
  },
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
