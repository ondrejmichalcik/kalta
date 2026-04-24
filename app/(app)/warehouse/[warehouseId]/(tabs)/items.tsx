// ============================================================================
// Kalta – Items tab
// Flat cross-box expiring timeline. Every item in the current warehouse,
// sorted by nearest expiry. Tap a row to edit the item in-place via the
// shared ItemEditSheet.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useGlobalSearchParams, useRouter } from 'expo-router';
import { Swipeable } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { listAllItemsInWarehouse, openOneItem } from '@/src/lib/supabase';
import type { ItemWithBox } from '@/src/types/database';
import {
  EXPIRY_COLORS,
  compareItemsByPriority,
  formatExpiry,
  formatItemQuantity,
  getExpiryStatus,
} from '@/src/types/database';
import { colors, radius, spacing, typography } from '@/src/theme';
import { Card } from '@/src/components/Card';
import { Icon } from '@/src/components/Icon';
import { ListHeader } from '@/src/components/ListHeader';
import { StatusDot } from '@/src/components/StatusDot';
import { ItemEditSheet } from '@/src/components/ItemEditSheet';
import {
  ActiveFilterChips,
  FilterSheet,
  matchesCategoryFilter,
  matchesConditionFilter,
  matchesExpiryFilter,
  type CategoryFilter,
  type ConditionFilter,
  type StatusFilter,
} from '@/src/components/FilterSheet';

const TAB_BAR_HEIGHT = 84;

export default function ItemsScreen() {
  const router = useRouter();
  // useGlobalSearchParams — local params don't reliably include parent
  // dynamic segments after a tab switch in Expo Router's nested tab groups.
  const { warehouseId } = useGlobalSearchParams<{ warehouseId: string }>();
  const [items, setItems] = useState<ItemWithBox[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<ItemWithBox | null>(null);
  const openSwipeableRef = useRef<Swipeable | null>(null);

  // Search + Filter
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [conditionFilter, setConditionFilter] = useState<ConditionFilter>([]);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>([]);
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);
  const searchRef = useRef<TextInput>(null);

  const load = useCallback(async () => {
    if (!warehouseId) return;
    try {
      setError(null);
      const rows = await listAllItemsInWarehouse(warehouseId);
      setItems(rows);
    } catch (e: any) {
      setError(e?.message ?? 'Cannot load items.');
      throw e;
    }
  }, [warehouseId]);

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

  // Opened items bubble to the top of their expiry group so the user sees
  // "finish what you already started first" at a glance.
  const sortedItems = useMemo(() => [...items].sort(compareItemsByPriority), [items]);

  const filteredItems = useMemo(() => {
    let result = sortedItems;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.box_name.toLowerCase().includes(q),
      );
    }
    if (statusFilter !== 'all') {
      result = result.filter((i) => matchesExpiryFilter(i.expiry_date, statusFilter));
    }
    if (conditionFilter.length > 0) {
      result = result.filter((i) => matchesConditionFilter(i, conditionFilter));
    }
    if (categoryFilter.length > 0) {
      result = result.filter((i) => matchesCategoryFilter(i.category, categoryFilter));
    }
    return result;
  }, [sortedItems, searchQuery, statusFilter, conditionFilter, categoryFilter]);

  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    statusFilter !== 'all' ||
    conditionFilter.length > 0 ||
    categoryFilter.length > 0;

  // Count of non-search filters — displayed as a badge on the Filter button
  // so the user can tell at a glance that something is narrowing the list.
  const activeFilterCount =
    (statusFilter !== 'all' ? 1 : 0) +
    (conditionFilter.length > 0 ? 1 : 0) +
    (categoryFilter.length > 0 ? 1 : 0);

  const toggleSearch = () => {
    if (searchVisible) {
      setSearchQuery('');
      setSearchVisible(false);
    } else {
      setSearchVisible(true);
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  };

  const confirmOpen = (item: ItemWithBox, close: () => void) => {
    Alert.alert(
      'Mark one as opened',
      `Decrement sealed count of "${item.name}" by 1 and push one unit to an opened sibling?`,
      [
        { text: 'Cancel', style: 'cancel', onPress: close },
        {
          text: 'Mark opened',
          onPress: async () => {
            close();
            try {
              await openOneItem(item.id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
                () => {},
              );
              // Items tab has no realtime sub on items — reload manually.
              await load();
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'Cannot open.');
            }
          },
        },
      ],
    );
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

  if (error && items.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Icon brand="warning" size={96} style={styles.errorIcon} />
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ListHeader
        title="Items"
        subtitle={hasActiveFilters ? `${filteredItems.length} of ${items.length}` : 'Sorted by nearest expiry'}
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
            placeholder="Search by name or box..."
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

      {/* Active filter chips — tap × to remove one without opening the sheet. */}
      <ActiveFilterChips
        status={statusFilter}
        condition={conditionFilter}
        category={categoryFilter}
        onClearStatus={() => setStatusFilter('all')}
        onClearCondition={() => setConditionFilter([])}
        onClearCategory={() => setCategoryFilter([])}
      />

      <FlatList
        data={filteredItems}
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
            <Icon brand="inbox" size={120} style={styles.emptyIcon} />
            <Text style={styles.emptyTitle}>
              {hasActiveFilters ? 'No matches' : 'No items yet'}
            </Text>
            <Text style={styles.emptyText}>
              {hasActiveFilters
                ? 'Try a different search or filter.'
                : 'Open a box and add your first items.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <ItemRow
            item={item}
            onPress={() => setEditingItem(item)}
            onOpen={(close) => confirmOpen(item, close)}
            registerOpen={(ref) => {
              if (openSwipeableRef.current && openSwipeableRef.current !== ref) {
                openSwipeableRef.current.close();
              }
              openSwipeableRef.current = ref;
            }}
          />
        )}
      />

      <Modal
        visible={!!editingItem}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEditingItem(null)}
      >
        {editingItem && warehouseId && (
          <ItemEditSheet
            item={editingItem}
            warehouseId={warehouseId}
            onClose={() => setEditingItem(null)}
            onSaved={(updated) => {
              setItems((prev) =>
                prev.map((x) => (x.id === updated.id ? { ...updated, box_name: x.box_name } : x)),
              );
              setEditingItem(null);
            }}
            onDeleted={(itemId) => {
              setItems((prev) => prev.filter((x) => x.id !== itemId));
              setEditingItem(null);
            }}
            onOpened={() => {
              // No realtime sub on items in this tab — refetch cross-box list.
              setEditingItem(null);
              load().catch(() => {});
            }}
            onMoved={() => {
              setEditingItem(null);
              load().catch(() => {});
            }}
          />
        )}
      </Modal>

      <FilterSheet
        visible={filterSheetVisible}
        initial={{ status: statusFilter, condition: conditionFilter, category: categoryFilter }}
        onClose={() => setFilterSheetVisible(false)}
        onApply={({ status, condition, category }) => {
          setStatusFilter(status);
          setConditionFilter(condition);
          setCategoryFilter(category);
          setFilterSheetVisible(false);
        }}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// ItemRow — same pill style as BoxRow but with "in [Box name]" subtitle
// ---------------------------------------------------------------------------
function ItemRow({
  item,
  onPress,
  onOpen,
  registerOpen,
}: {
  item: ItemWithBox;
  onPress: () => void;
  onOpen: (close: () => void) => void;
  registerOpen: (ref: Swipeable | null) => void;
}) {
  const status = getExpiryStatus(item.expiry_date);
  const palette =
    status === 'none'
      ? { bg: colors.expiryNoneBg, fg: colors.expiryNoneText }
      : EXPIRY_COLORS[status];

  const subtitleParts = [formatItemQuantity(item), `in ${item.box_name}`];
  const swipeRef = useRef<Swipeable>(null);

  const canOpen =
    !item.opened && (item.unit === 'pcs' || item.unit === 'pack') && item.quantity >= 1;

  const renderLeftActions = () => (
    <Pressable
      style={styles.openAction}
      onPress={() => onOpen(() => swipeRef.current?.close())}
    >
      <Icon sf="shippingbox.fill" size={20} color={colors.warningText} />
      <Text style={styles.openActionText}>Open</Text>
    </Pressable>
  );

  const rowContent = (
    <Card onPress={onPress} style={styles.card}>
      <StatusDot status={status} />
      <View style={styles.cardBody}>
        <View style={styles.titleRow}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {item.name}
          </Text>
          {item.opened && (
            <View style={styles.openedBadge}>
              <Text style={styles.openedBadgeText}>OPENED</Text>
            </View>
          )}
          {item.damaged && (
            <View style={styles.damagedBadge}>
              <Text style={styles.damagedBadgeText}>DAMAGED</Text>
            </View>
          )}
          {item.notes && (
            <View style={styles.notesBadge}>
              <Text style={styles.notesBadgeText}>NOTE</Text>
            </View>
          )}
        </View>
        <Text style={styles.cardSubtitle} numberOfLines={1}>
          {subtitleParts.join(' · ')}
        </Text>
      </View>
      {item.expiry_date ? (
        <View style={[styles.badge, { backgroundColor: palette.bg }]}>
          <Text style={[styles.badgeText, { color: palette.fg }]} numberOfLines={1}>
            {formatExpiry(item.expiry_date)}
          </Text>
        </View>
      ) : null}
      <Icon sf="chevron.right" size={14} color={colors.textSubtle} />
    </Card>
  );

  // No swipe wrapper when there's nothing to reveal — avoids a dead gesture
  // area on rows that can't be opened (opened rows, continuous units).
  if (!canOpen) {
    return <View style={styles.rowWrap}>{rowContent}</View>;
  }

  return (
    <View style={styles.rowWrap}>
      <Swipeable
        ref={swipeRef}
        renderLeftActions={renderLeftActions}
        leftThreshold={40}
        overshootLeft={false}
        onSwipeableWillOpen={() => registerOpen(swipeRef.current)}
      >
        {rowContent}
      </Swipeable>
    </View>
  );
}

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
  },

  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: TAB_BAR_HEIGHT + 24,
    gap: spacing.sm + 2,
  },
  rowWrap: {
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  card: {
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md + 2,
  },
  openAction: {
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.warningBgStrong,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
    width: 88,
    borderTopLeftRadius: radius.lg,
    borderBottomLeftRadius: radius.lg,
  },
  openActionText: {
    ...typography.caption,
    color: colors.warningText,
    fontWeight: '700',
  },
  cardBody: {
    flex: 1,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  cardTitle: {
    ...typography.headline,
    color: colors.text,
    flexShrink: 1,
  },
  openedBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.warningBgStrong,
  },
  openedBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.warningText,
    letterSpacing: 0.5,
  },
  damagedBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerBgStrong,
  },
  damagedBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.danger,
    letterSpacing: 0.5,
  },
  notesBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.infoBg,
  },
  notesBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.infoText,
    letterSpacing: 0.5,
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
