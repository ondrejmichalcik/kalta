// ============================================================================
// Kalta – Box detail
// List of items in a single box with swipe-to-delete, realtime subscription,
// and a contextual "Add items" FAB.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Swipeable } from 'react-native-gesture-handler';
import QRCode from 'react-native-qrcode-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { getCachedUri } from '@/src/lib/imageCache';
import { ItemEditSheet } from '@/src/components/ItemEditSheet';
import { BoxEditSheet } from '@/src/components/BoxEditSheet';
import { Icon } from '@/src/components/Icon';
import { Card } from '@/src/components/Card';
import { FAB } from '@/src/components/FAB';
import { StatusDot } from '@/src/components/StatusDot';
import {
  deleteBox,
  deleteItem,
  getActiveUserId,
  getBoxById,
  getMyWarehouses,
  listItems,
  moveItemQuantity,
  openOneItem,
  supabase,
  subscribeItems,
  verifyItems,
} from '@/src/lib/supabase';
import {
  printBoxLabel,
  printBoxLabelViaBrotherSDK,
  shareBoxLabelPdf,
} from '@/src/lib/qrLabel';
import { BoxPicker } from '@/src/components/BoxPicker';
import type { Box, Item, Category, Role } from '@/src/types/database';
import {
  EXPIRY_COLORS,
  compareItemsByPriority,
  formatExpiry,
  formatItemQuantity,
  formatVerified,
  getExpiryStatus,
} from '@/src/types/database';
import { colors, radius, shadows, spacing, typography } from '@/src/theme';
import type { SFSymbolName } from '@/src/components/Icon';
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

type ViewMode = 'list' | 'grid';
const VIEW_MODE_KEY = 'kalta:boxViewMode';

// Category → SF Symbol mapping. Kept here because it's a display concern
// and the SF symbol names are stable strings.
const CATEGORY_SF: Record<Category, SFSymbolName> = {
  food: 'fork.knife',
  medicine: 'pills.fill',
  water: 'drop.fill',
  disinfectant: 'bubbles.and.sparkles.fill',
  equipment: 'wrench.adjustable.fill',
  energy: 'bolt.fill',
  documents: 'doc.fill',
  other: 'shippingbox.fill',
};

export default function BoxDetailScreen() {
  const router = useRouter();
  const { warehouseId, boxId: id } = useLocalSearchParams<{ warehouseId: string; boxId: string }>();
  const [box, setBox] = useState<Box | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [myRole, setMyRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showLabel, setShowLabel] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [error, setError] = useState<string | null>(null);

  // Multi-select mode for batch move
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showMovePicker, setShowMovePicker] = useState(false);
  const [moveTarget, setMoveTarget] = useState<Box | null>(null);
  const [moveQuantities, setMoveQuantities] = useState<Record<string, number>>({});

  // Inventory mode
  const [inventoryMode, setInventoryMode] = useState(false);
  const [verifiedIds, setVerifiedIds] = useState<Set<string>>(new Set());

  // Filter (mirrors Items tab — status / condition / category)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [conditionFilter, setConditionFilter] = useState<ConditionFilter>([]);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>([]);
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);

  // Load persisted view mode preference (global across all boxes).
  useEffect(() => {
    AsyncStorage.getItem(VIEW_MODE_KEY).then((v) => {
      if (v === 'list' || v === 'grid') setViewMode(v);
    });
  }, []);

  const setMode = (mode: ViewMode) => {
    setViewMode(mode);
    AsyncStorage.setItem(VIEW_MODE_KEY, mode).catch(() => {});
  };

  // Keep a ref to the currently-open Swipeable so we can close it on other
  // interactions.
  const openSwipeableRef = useRef<Swipeable | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setError(null);
      const [b, is] = await Promise.all([getBoxById(id), listItems(id)]);
      setBox(b);
      setItems(is);
      // Resolve user's role in this warehouse for gating destructive actions
      if (warehouseId) {
        const uid = await getActiveUserId();
        if (uid) {
          const whs = await getMyWarehouses(uid);
          const wh = whs.find((w) => w.id === warehouseId);
          if (wh) setMyRole(wh.my_role);
        }
      }
    } catch (e: any) {
      setError(e?.message ?? 'Cannot load box.');
      throw e;
    }
  }, [id, warehouseId]);

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
    if (!id) return;
    const unsubscribe = subscribeItems(id, () => {
      load().catch(() => {});
    });
    return unsubscribe;
  }, [id, load]);

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

  const handleDeleteBox = () => {
    if (!box) return;
    Alert.alert(
      'Delete box',
      `Really delete "${box.name}"? All items in this box will be deleted with it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteBox(box.id);
              router.replace(`/warehouse/${warehouseId}` as any);
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'Cannot delete.');
            }
          },
        },
      ],
    );
  };

  const isOwner = myRole === 'owner';

  const showBoxActionSheet = () => {
    const options = [
      'Show QR label',
      'Edit box',
      'Select & move items',
      'Inventory check',
      'Inventory history',
      ...(isOwner ? ['Delete box'] : []),
      'Cancel',
    ];
    const destructiveIdx = isOwner ? options.length - 2 : -1;
    const cancelIdx = options.length - 1;

    ActionSheetIOS.showActionSheetWithOptions(
      {
        options,
        destructiveButtonIndex: destructiveIdx >= 0 ? destructiveIdx : undefined,
        cancelButtonIndex: cancelIdx,
        title: box?.name ?? undefined,
      },
      (idx) => {
        if (idx === 0) setShowLabel(true);
        else if (idx === 1) setShowEdit(true);
        else if (idx === 2) {
          setSelectMode(true);
          setSelectedIds(new Set());
        }
        else if (idx === 3) {
          if (box) {
            router.push(
              `/warehouse/${warehouseId}/box/${box.id}/inventory` as any,
            );
          }
        }
        else if (idx === 4) {
          if (box) {
            router.push(
              `/warehouse/${warehouseId}/box/${box.id}/inventories` as any,
            );
          }
        }
        else if (isOwner && idx === options.length - 2) handleDeleteBox();
      },
    );
  };

  const confirmDelete = (item: Item, close: () => void) => {
    Alert.alert('Delete item', `Really delete "${item.name}"?`, [
      {
        text: 'Cancel',
        style: 'cancel',
        onPress: close,
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          close();
          try {
            await deleteItem(item.id);
            setItems((prev) => prev.filter((x) => x.id !== item.id));
          } catch (e: any) {
            Alert.alert('Error', e?.message ?? 'Cannot delete.');
          }
        },
      },
    ]);
  };

  const confirmOpen = (item: Item, close: () => void) => {
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
              // Realtime sub on items will reload the list automatically.
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'Cannot open.');
            }
          },
        },
      ],
    );
  };

  // ---- Inventory mode handlers ----

  const toggleVerifyItem = (id: string) => {
    setVerifiedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const verifyAll = () => {
    setVerifiedIds(new Set(items.map((i) => i.id)));
  };

  const completeInventory = async () => {
    if (verifiedIds.size === 0) {
      Alert.alert('Nothing verified', 'Tap items you physically see in the box.');
      return;
    }
    try {
      await verifyItems([...verifiedIds]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      const notFound = items.length - verifiedIds.size;
      Alert.alert(
        'Inventory complete',
        `${verifiedIds.size} verified${notFound > 0 ? `, ${notFound} not found` : ''}`,
      );
      setInventoryMode(false);
      setVerifiedIds(new Set());
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Cannot save inventory.');
    }
  };

  const exitInventory = () => {
    setInventoryMode(false);
    setVerifiedIds(new Set());
  };

  // ---- Multi-select handlers ----

  const toggleSelectItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  // Step 1: BoxPicker selects target → initialize per-item quantities
  const handleBatchMovePickTarget = (targetBox: Box) => {
    setShowMovePicker(false);
    const qtys: Record<string, number> = {};
    for (const id of selectedIds) {
      const item = items.find((i) => i.id === id);
      if (item) qtys[id] = item.quantity;
    }
    setMoveQuantities(qtys);
    setMoveTarget(targetBox);
  };

  // Step 2: User confirms quantities → execute moves
  const executeBatchMove = async () => {
    if (!moveTarget) return;
    try {
      const userId = (await getActiveUserId()) ?? '';

      for (const id of selectedIds) {
        const item = items.find((i) => i.id === id);
        if (!item) continue;
        const qty = moveQuantities[id] ?? item.quantity;
        if (qty <= 0) continue;

        await moveItemQuantity(
          id,
          qty >= item.quantity ? 'all' : qty,
          moveTarget.id,
          userId,
        );
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setMoveTarget(null);
      exitSelectMode();
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Cannot move items.');
    }
  };

  const sortedItems = useMemo(() => [...items].sort(compareItemsByPriority), [items]);

  const filteredItems = useMemo(() => {
    let result = sortedItems;
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
  }, [sortedItems, statusFilter, conditionFilter, categoryFilter]);

  const activeFilterCount =
    (statusFilter !== 'all' ? 1 : 0) +
    (conditionFilter.length > 0 ? 1 : 0) +
    (categoryFilter.length > 0 ? 1 : 0);

  const nearest = useMemo(() => box?.nearest_expiry ?? null, [box]);
  const nearestStatus = getExpiryStatus(nearest);
  const nearestPalette =
    nearestStatus === 'none'
      ? { bg: colors.expiryNoneBg, fg: colors.expiryNoneText }
      : EXPIRY_COLORS[nearestStatus];

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error && !box) {
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
          <Pressable
            style={styles.secondaryBtn}
            onPress={() => router.replace(`/warehouse/${warehouseId}` as any)}
          >
            <Text style={styles.secondaryBtnText}>Back to boxes</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!box) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Box not found</Text>
          <Pressable
            style={styles.retryBtn}
            onPress={() => router.replace(`/warehouse/${warehouseId}` as any)}
          >
            <Text style={styles.retryText}>Back to boxes</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Top nav bar */}
      <View style={styles.topBar}>
        <Pressable
          hitSlop={12}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.topBarBtn, pressed && { opacity: 0.5 }]}
        >
          <Icon sf="chevron.left" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.topBarTitle} numberOfLines={1}>
          {box.name}
        </Text>
        <Pressable
          hitSlop={12}
          onPress={() => setFilterSheetVisible(true)}
          accessibilityLabel="Filter"
          style={({ pressed }) => [styles.topBarBtn, pressed && { opacity: 0.5 }]}
        >
          <Icon
            sf="line.3.horizontal.decrease"
            size={22}
            color={activeFilterCount > 0 ? colors.primary : colors.text}
          />
          {activeFilterCount > 0 ? (
            <View style={styles.topBarBadge}>
              <Text style={styles.topBarBadgeText}>{activeFilterCount}</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          hitSlop={12}
          onPress={showBoxActionSheet}
          style={({ pressed }) => [styles.topBarBtn, pressed && { opacity: 0.5 }]}
        >
          <Icon sf="ellipsis" size={22} color={colors.text} />
        </Pressable>
      </View>

      {/* Meta row */}
      <View style={styles.meta}>
        {box.location ? (
          <View style={styles.metaItem}>
            <Icon sf="mappin" size={14} color={colors.textMuted} />
            <Text style={styles.metaText}>{box.location}</Text>
          </View>
        ) : null}
        <View style={styles.metaItem}>
          <Icon sf="cube.box" size={14} color={colors.textMuted} />
          <Text style={styles.metaText}>
            {box.item_count} {box.item_count === 1 ? 'item' : 'items'}
          </Text>
        </View>
        <View style={[styles.nearestBadge, { backgroundColor: nearestPalette.bg }]}>
          <Text style={[styles.nearestBadgeText, { color: nearestPalette.fg }]}>
            {formatExpiry(nearest)}
          </Text>
        </View>
      </View>

      {/* Active filter chips — tap × to clear one without opening the sheet. */}
      <ActiveFilterChips
        status={statusFilter}
        condition={conditionFilter}
        category={categoryFilter}
        onClearStatus={() => setStatusFilter('all')}
        onClearCondition={() => setConditionFilter([])}
        onClearCategory={() => setCategoryFilter([])}
      />

      {/* View mode segmented control */}
      <View style={styles.segmented}>
        <Pressable
          onPress={() => setMode('list')}
          style={[styles.segment, viewMode === 'list' && styles.segmentActive]}
        >
          <Icon
            sf="list.bullet"
            size={16}
            color={viewMode === 'list' ? colors.text : colors.textMuted}
          />
          <Text style={[styles.segmentText, viewMode === 'list' && styles.segmentTextActive]}>
            List
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setMode('grid')}
          style={[styles.segment, viewMode === 'grid' && styles.segmentActive]}
        >
          <Icon
            sf="square.grid.2x2"
            size={16}
            color={viewMode === 'grid' ? colors.text : colors.textMuted}
          />
          <Text style={[styles.segmentText, viewMode === 'grid' && styles.segmentTextActive]}>
            Grid
          </Text>
        </Pressable>
      </View>

      <FlatList
        key={viewMode}
        data={filteredItems}
        keyExtractor={(item) => item.id}
        numColumns={viewMode === 'grid' ? 3 : 1}
        contentContainerStyle={viewMode === 'grid' ? styles.gridContent : styles.listContent}
        columnWrapperStyle={viewMode === 'grid' ? styles.gridRow : undefined}
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
            <Text style={styles.emptyTitle}>Box is empty</Text>
            <Text style={styles.emptyText}>Add your first items.</Text>
          </View>
        }
        renderItem={({ item }) =>
          inventoryMode ? (
            <Pressable
              onPress={() => toggleVerifyItem(item.id)}
              style={({ pressed }) => [
                styles.selectRow,
                verifiedIds.has(item.id) && styles.inventoryVerified,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Icon
                sf={verifiedIds.has(item.id) ? 'checkmark.circle.fill' : 'circle'}
                size={24}
                color={verifiedIds.has(item.id) ? colors.success : colors.textMuted}
              />
              <View style={styles.selectRowBody}>
                <Text style={styles.selectRowName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.selectRowQty} numberOfLines={1}>
                  {formatItemQuantity(item)}
                </Text>
              </View>
              {item.opened && (
                <View style={styles.openedBadge}>
                  <Text style={styles.openedBadgeText}>OPENED</Text>
                </View>
              )}
            </Pressable>
          ) : selectMode ? (
            <Pressable
              onPress={() => toggleSelectItem(item.id)}
              style={({ pressed }) => [styles.selectRow, pressed && { opacity: 0.7 }]}
            >
              <Icon
                sf={selectedIds.has(item.id) ? 'checkmark.circle.fill' : 'circle'}
                size={24}
                color={selectedIds.has(item.id) ? colors.primary : colors.textMuted}
              />
              <View style={styles.selectRowBody}>
                <Text style={styles.selectRowName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.selectRowQty} numberOfLines={1}>
                  {formatItemQuantity(item)}
                </Text>
              </View>
            </Pressable>
          ) : viewMode === 'list' ? (
            <SwipeableRow
              item={item}
              onPress={() => setEditingItem(item)}
              onDelete={(close) => confirmDelete(item, close)}
              onOpen={(close) => confirmOpen(item, close)}
              registerOpen={(ref) => {
                if (openSwipeableRef.current && openSwipeableRef.current !== ref) {
                  openSwipeableRef.current.close();
                }
                openSwipeableRef.current = ref;
              }}
            />
          ) : (
            <GridCard item={item} onPress={() => setEditingItem(item)} />
          )
        }
      />

      {/* Multi-select bottom action bar */}
      {selectMode && (
        <View style={styles.selectBar}>
          <Pressable onPress={exitSelectMode} style={styles.selectBarCancel}>
            <Text style={styles.selectBarCancelText}>Cancel</Text>
          </Pressable>
          <Text style={styles.selectBarCount}>
            {selectedIds.size} selected
          </Text>
          <Pressable
            onPress={() => {
              if (selectedIds.size === 0) {
                Alert.alert('No items selected', 'Tap items to select them first.');
                return;
              }
              setShowMovePicker(true);
            }}
            style={[styles.selectBarMove, selectedIds.size === 0 && { opacity: 0.4 }]}
          >
            <Icon sf="arrow.right.arrow.left" size={16} color={colors.textOnPrimary} />
            <Text style={styles.selectBarMoveText}>Move</Text>
          </Pressable>
        </View>
      )}

      {/* Inventory bottom bar */}
      {inventoryMode && (
        <View style={styles.selectBar}>
          <Pressable onPress={exitInventory} style={styles.selectBarCancel}>
            <Text style={styles.selectBarCancelText}>Cancel</Text>
          </Pressable>
          <Pressable onPress={verifyAll} style={styles.selectBarCancel}>
            <Text style={[styles.selectBarCancelText, { color: colors.primary }]}>All</Text>
          </Pressable>
          <Text style={styles.selectBarCount}>
            {verifiedIds.size} / {items.length} verified
          </Text>
          <Pressable
            style={({ pressed }) => [styles.inventoryCompleteBtn, pressed && { opacity: 0.8 }]}
            onPress={completeInventory}
          >
            <Icon sf="checkmark.shield.fill" size={16} color={colors.textOnPrimary} />
            <Text style={styles.selectBarMoveText}>Done</Text>
          </Pressable>
        </View>
      )}

      {!selectMode && !inventoryMode && (
        <FAB
          label="Add items"
          sfIcon="plus"
          bottom={24}
          onPress={() =>
            router.push(`/warehouse/${warehouseId}/box/${box.id}/add-items` as any)
          }
        />
      )}

      {/* Box picker for batch move */}
      <Modal
        visible={showMovePicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowMovePicker(false)}
      >
        {showMovePicker && warehouseId && box && (
          <BoxPicker
            warehouseId={warehouseId}
            excludeBoxId={box.id}
            onSelect={handleBatchMovePickTarget}
            onClose={() => setShowMovePicker(false)}
          />
        )}
      </Modal>

      {/* Move quantity confirmation */}
      <Modal
        visible={!!moveTarget}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setMoveTarget(null)}
      >
        {moveTarget && (
          <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
            <View style={styles.moveConfirmHeader}>
              <Text style={styles.moveConfirmTitle}>
                Move to {moveTarget.name}
              </Text>
              <Pressable hitSlop={12} onPress={() => setMoveTarget(null)}>
                <Text style={styles.moveConfirmClose}>Cancel</Text>
              </Pressable>
            </View>
            <Text style={styles.moveConfirmHint}>
              Adjust quantities for each item. Set 0 to skip.
            </Text>
            <FlatList
              data={items.filter((i) => selectedIds.has(i.id))}
              keyExtractor={(i) => i.id}
              contentContainerStyle={styles.moveConfirmList}
              renderItem={({ item: it }) => (
                <View style={styles.moveConfirmRow}>
                  <View style={styles.moveConfirmRowBody}>
                    <Text style={styles.moveConfirmRowName} numberOfLines={1}>
                      {it.name}
                    </Text>
                    <Text style={styles.moveConfirmRowInfo}>
                      {it.quantity} {it.unit} available
                    </Text>
                  </View>
                  <View style={styles.moveConfirmQtyWrap}>
                    <Pressable
                      onPress={() =>
                        setMoveQuantities((p) => ({
                          ...p,
                          [it.id]: Math.max(0, (p[it.id] ?? it.quantity) - 1),
                        }))
                      }
                      style={styles.moveConfirmQtyBtn}
                    >
                      <Icon sf="minus" size={14} color={colors.text} />
                    </Pressable>
                    <TextInput
                      value={String(moveQuantities[it.id] ?? it.quantity)}
                      onChangeText={(v: string) => {
                        const n = parseInt(v, 10);
                        setMoveQuantities((p) => ({
                          ...p,
                          [it.id]: Number.isFinite(n)
                            ? Math.min(Math.max(0, n), it.quantity)
                            : 0,
                        }));
                      }}
                      keyboardType="number-pad"
                      style={styles.moveConfirmQtyInput}
                      selectTextOnFocus
                    />
                    <Pressable
                      onPress={() =>
                        setMoveQuantities((p) => ({
                          ...p,
                          [it.id]: Math.min(it.quantity, (p[it.id] ?? it.quantity) + 1),
                        }))
                      }
                      style={styles.moveConfirmQtyBtn}
                    >
                      <Icon sf="plus" size={14} color={colors.text} />
                    </Pressable>
                  </View>
                </View>
              )}
            />
            <View style={styles.moveConfirmFooter}>
              <Pressable
                style={({ pressed }) => [styles.moveConfirmBtn, pressed && { opacity: 0.8 }]}
                onPress={executeBatchMove}
              >
                <Icon sf="arrow.right.arrow.left" size={18} color={colors.textOnPrimary} />
                <Text style={styles.moveConfirmBtnText}>
                  Move {Object.values(moveQuantities).filter((q) => q > 0).length} items
                </Text>
              </Pressable>
            </View>
          </SafeAreaView>
        )}
      </Modal>

      {/* QR label modal */}
      <Modal
        visible={showLabel}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowLabel(false)}
      >
        <LabelModalContent box={box} onClose={() => setShowLabel(false)} />
      </Modal>

      {/* Edit box modal */}
      <Modal
        visible={showEdit}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowEdit(false)}
      >
        <BoxEditSheet
          box={box}
          onClose={() => setShowEdit(false)}
          onSaved={(updated) => {
            setBox(updated);
            setShowEdit(false);
          }}
        />
      </Modal>

      {/* Edit item modal */}
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
              setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
              setEditingItem(null);
            }}
            onDeleted={(itemId) => {
              setItems((prev) => prev.filter((x) => x.id !== itemId));
              setEditingItem(null);
            }}
            onOpened={() => {
              // Realtime sub on items reloads the list — just close the sheet.
              setEditingItem(null);
            }}
            onMoved={() => {
              // Realtime sub won't fire for items LEAVING this box (filter
              // matches NEW row values, moved item has target box_id now).
              // Force reload to reflect the removal.
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
// LabelModalContent
// ---------------------------------------------------------------------------

function LabelModalContent({ box, onClose }: { box: Box; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [printing, setPrinting] = useState(false);

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(box.qr_code);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  const handlePrint = async () => {
    try {
      setPrinting(true);
      await printBoxLabel(box);
    } catch (e: any) {
      // User-cancelled dismiss throws "Printing did not complete" — swallow
      // quietly. Real errors (network, etc.) surface to the user.
      const msg = String(e?.message ?? '');
      if (!msg.toLowerCase().includes('did not complete')) {
        Alert.alert('Print error', msg || 'Cannot open print dialog.');
      }
    } finally {
      setPrinting(false);
    }
  };

  const handleSharePdf = async () => {
    try {
      setPrinting(true);
      await shareBoxLabelPdf(box);
    } catch (e: any) {
      Alert.alert('Share error', e?.message ?? 'Cannot share PDF.');
    } finally {
      setPrinting(false);
    }
  };

  const handlePrintDirect = async () => {
    try {
      setPrinting(true);
      await printBoxLabelViaBrotherSDK(box);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) {
      Alert.alert('Brother print error', e?.message ?? 'Cannot print via Brother SDK.');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.modalHeader}>
        <Text style={styles.modalTitle}>QR label</Text>
        <Pressable hitSlop={12} onPress={onClose}>
          <Text style={styles.modalClose}>Close</Text>
        </Pressable>
      </View>

      <View style={styles.modalBody}>
        <Text style={styles.labelBoxName}>{box.name}</Text>
        {box.location ? (
          <View style={styles.metaItem}>
            <Icon sf="mappin" size={14} color={colors.textMuted} />
            <Text style={styles.metaText}>{box.location}</Text>
          </View>
        ) : null}

        <View style={styles.labelQrWrap}>
          <QRCode
            value={box.qr_code}
            size={220}
            backgroundColor="#FFFFFF"
            ecl="H"
            logo={require('@/assets/label-logo.png')}
            logoSize={92}
            logoBackgroundColor="#FFFFFF"
            logoMargin={0}
            logoBorderRadius={12}
          />
        </View>

        <Pressable
          onPress={handleCopy}
          style={({ pressed }) => [styles.labelCodeWrap, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.labelCode} numberOfLines={1}>
            {box.qr_code}
          </Text>
          <View style={styles.labelCopyRow}>
            <Icon
              sf={copied ? 'checkmark.circle.fill' : 'doc.on.doc'}
              size={14}
              color={copied ? colors.success : colors.primary}
            />
            <Text style={[styles.labelCopyHint, copied && styles.labelCopyHintActive]}>
              {copied ? 'Copied' : 'Copy'}
            </Text>
          </View>
        </Pressable>

        <View style={styles.labelHint}>
          <Text style={styles.labelHintText}>
            This QR stays the same for the box's entire lifetime. Stick it on the outside —
            scanning it opens the box detail instantly.
          </Text>
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.printBtn,
            printing && { opacity: 0.6 },
            pressed && !printing && { opacity: 0.7 },
          ]}
          onPress={handlePrintDirect}
          disabled={printing}
        >
          {printing ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <>
              <Icon sf="printer.fill" size={18} color={colors.primary} />
              <Text style={styles.printBtnText}>Print to Brother</Text>
            </>
          )}
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.sharePdfBtn,
            printing && { opacity: 0.6 },
            pressed && !printing && { opacity: 0.7 },
          ]}
          onPress={handlePrint}
          disabled={printing}
        >
          <Icon sf="printer" size={16} color={colors.textMuted} />
          <Text style={styles.sharePdfBtnText}>AirPrint / other</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.sharePdfBtn,
            printing && { opacity: 0.6 },
            pressed && !printing && { opacity: 0.7 },
          ]}
          onPress={handleSharePdf}
          disabled={printing}
        >
          <Icon sf="square.and.arrow.up" size={16} color={colors.textMuted} />
          <Text style={styles.sharePdfBtnText}>Save PDF</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// SwipeableRow
// ---------------------------------------------------------------------------

function SwipeableRow({
  item,
  onPress,
  onDelete,
  onOpen,
  registerOpen,
}: {
  item: Item;
  onPress: () => void;
  onDelete: (close: () => void) => void;
  onOpen: (close: () => void) => void;
  registerOpen: (ref: Swipeable | null) => void;
}) {
  const status = getExpiryStatus(item.expiry_date);
  const palette =
    status === 'none'
      ? { bg: colors.expiryNoneBg, fg: colors.expiryNoneText }
      : EXPIRY_COLORS[status];
  const sfIcon: SFSymbolName = item.category ? CATEGORY_SF[item.category] : 'shippingbox.fill';
  const swipeRef = useRef<Swipeable>(null);

  // Left swipe reveals "Mark one as opened" — sealed discrete items only.
  const canOpen =
    !item.opened && (item.unit === 'pcs' || item.unit === 'pack') && item.quantity >= 1;

  const renderRightActions = () => (
    <Pressable
      style={styles.deleteAction}
      onPress={() => onDelete(() => swipeRef.current?.close())}
    >
      <Icon sf="trash.fill" size={20} color="#FFFFFF" />
      <Text style={styles.deleteActionText}>Delete</Text>
    </Pressable>
  );

  const renderLeftActions = () => (
    <Pressable
      style={styles.openAction}
      onPress={() => onOpen(() => swipeRef.current?.close())}
    >
      <Icon sf="shippingbox.fill" size={20} color={colors.warningText} />
      <Text style={styles.openActionText}>Open</Text>
    </Pressable>
  );

  return (
    <View style={styles.rowWrap}>
      <Swipeable
        ref={swipeRef}
        renderRightActions={renderRightActions}
        renderLeftActions={canOpen ? renderLeftActions : undefined}
        rightThreshold={40}
        leftThreshold={40}
        overshootRight={false}
        overshootLeft={false}
        onSwipeableWillOpen={() => registerOpen(swipeRef.current)}
      >
        <Card onPress={onPress} style={styles.row}>
          <StatusDot status={status} />
          <View style={styles.rowBody}>
            <View style={styles.rowTitleLine}>
              <Text style={styles.rowName} numberOfLines={1}>
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
                  <Icon sf="note.text" size={9} color={colors.infoText} />
                  <Text style={styles.notesBadgeText}>NOTE</Text>
                </View>
              )}
            </View>
            <Text style={styles.rowQty} numberOfLines={1}>
              {formatItemQuantity(item)}
              {item.last_verified ? ` · ${formatVerified(item.last_verified)}` : ''}
            </Text>
          </View>
          {item.expiry_date ? (
            <View style={[styles.rowBadge, { backgroundColor: palette.bg }]}>
              <Text style={[styles.rowBadgeText, { color: palette.fg }]} numberOfLines={1}>
                {formatExpiry(item.expiry_date)}
              </Text>
            </View>
          ) : null}
          {item.image_url ? (
            <Image source={{ uri: getCachedUri(item.image_url)! }} style={styles.rowThumb} />
          ) : (
            <Icon sf={sfIcon} size={20} color={colors.textMuted} />
          )}
        </Card>
      </Swipeable>
    </View>
  );
}

function formatShortExpiry(dateStr: string): string {
  const [y, m] = dateStr.split('-');
  return `${m}/${y.slice(2)}`;
}

// ---------------------------------------------------------------------------
// GridCard — tap opens edit sheet (no swipe in grid mode)
// ---------------------------------------------------------------------------

function GridCard({ item, onPress }: { item: Item; onPress: () => void }) {
  const status = getExpiryStatus(item.expiry_date);
  const palette =
    status === 'none'
      ? { bg: colors.expiryNoneBg, fg: colors.expiryNoneText }
      : EXPIRY_COLORS[status];
  const sfIcon: SFSymbolName = item.category ? CATEGORY_SF[item.category] : 'shippingbox.fill';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.gridCard, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.gridImageWrap}>
        {item.image_url ? (
          <Image source={{ uri: getCachedUri(item.image_url)! }} style={styles.gridImage} />
        ) : (
          <Icon sf={sfIcon} size={36} color={colors.textMuted} />
        )}
        {item.opened && (
          <View style={styles.gridOpenedBadge}>
            <Text style={styles.gridOpenedBadgeText}>OPENED</Text>
          </View>
        )}
      </View>
      <Text numberOfLines={2} style={styles.gridName}>
        {item.name}
      </Text>
      <Text style={styles.gridQty}>{formatItemQuantity(item)}</Text>
      {item.expiry_date && (
        <View style={[styles.gridBadge, { backgroundColor: palette.bg }]}>
          <Text style={[styles.gridBadgeText, { color: palette.fg }]} numberOfLines={1}>
            {formatShortExpiry(item.expiry_date)}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
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
  secondaryBtn: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  secondaryBtnText: {
    ...typography.body,
    color: colors.textMuted,
  },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  topBarBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarBadge: {
    position: 'absolute',
    top: 6,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarBadgeText: {
    color: colors.textOnPrimary,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
  topBarTitle: {
    ...typography.headline,
    color: colors.text,
    flex: 1,
    textAlign: 'center',
    marginHorizontal: spacing.sm,
  },

  // Meta row
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  metaText: {
    ...typography.footnote,
    color: colors.textMuted,
  },
  nearestBadge: {
    marginLeft: 'auto',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  nearestBadgeText: {
    ...typography.caption,
    fontWeight: '700',
  },

  // Segmented control
  segmented: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    backgroundColor: colors.palette.neutral[100],
    borderRadius: radius.md,
    padding: 3,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm + 2,
  },
  segmentActive: {
    backgroundColor: colors.surface,
    ...shadows.sm,
  },
  segmentText: {
    ...typography.footnote,
    color: colors.textMuted,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: colors.text,
    fontWeight: '700',
  },

  // List content
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 100,
    gap: spacing.sm + 2,
  },
  rowWrap: {
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  row: {
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md + 2,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  rowName: {
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.infoBg,
    borderWidth: 1,
    borderColor: colors.infoBg,
  },
  notesBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.infoText,
    letterSpacing: 0.5,
  },
  rowQty: {
    ...typography.footnote,
    color: colors.textMuted,
  },
  rowBadge: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.full,
    maxWidth: 110,
  },
  rowBadgeText: {
    ...typography.caption,
    fontWeight: '700',
  },
  rowThumb: {
    width: 36,
    height: 36,
    borderRadius: radius.sm + 2,
    resizeMode: 'contain',
  },

  // Swipe delete action (right swipe)
  deleteAction: {
    backgroundColor: colors.danger,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
    width: 88,
    borderTopRightRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  deleteActionText: {
    ...typography.caption,
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // Swipe open action (left swipe) — amber to match OPENED badge
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

  // Grid
  gridContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: 100,
  },
  gridRow: {
    gap: spacing.sm,
  },
  gridCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    alignItems: 'center',
    minHeight: 150,
    ...shadows.sm,
  },
  gridImageWrap: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radius.sm + 2,
    backgroundColor: colors.palette.neutral[100],
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
    overflow: 'hidden',
  },
  gridImage: { width: '100%', height: '100%', resizeMode: 'contain' },
  gridOpenedBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: radius.sm,
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.warningBgStrong,
  },
  gridOpenedBadgeText: {
    fontSize: 8,
    fontWeight: '800',
    color: colors.warningText,
    letterSpacing: 0.3,
  },
  gridName: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '600',
    textAlign: 'center',
  },
  gridQty: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  gridBadge: {
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  gridBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },

  // Multi-select mode
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md + 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selectRowBody: {
    flex: 1,
    gap: 2,
  },
  selectRowName: {
    ...typography.headline,
    color: colors.text,
  },
  selectRowQty: {
    ...typography.footnote,
    color: colors.textMuted,
  },
  inventoryVerified: {
    backgroundColor: colors.successBg,
    borderColor: colors.successBgStrong,
  },
  inventoryCompleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    backgroundColor: colors.success,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.full,
  },
  selectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  selectBarCancel: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  selectBarCancelText: {
    ...typography.body,
    color: colors.textMuted,
    fontWeight: '600',
  },
  selectBarCount: {
    ...typography.footnote,
    color: colors.text,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
  },
  selectBarMove: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.full,
  },
  selectBarMoveText: {
    ...typography.footnote,
    color: colors.textOnPrimary,
    fontWeight: '700',
  },

  // Move confirmation modal
  moveConfirmHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  moveConfirmTitle: {
    ...typography.headline,
    color: colors.text,
    flex: 1,
    marginRight: spacing.md,
  },
  moveConfirmClose: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
  moveConfirmHint: {
    ...typography.footnote,
    color: colors.textMuted,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  moveConfirmList: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  moveConfirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  moveConfirmRowBody: {
    flex: 1,
    gap: 2,
  },
  moveConfirmRowName: {
    ...typography.headline,
    color: colors.text,
  },
  moveConfirmRowInfo: {
    ...typography.footnote,
    color: colors.textMuted,
  },
  moveConfirmQtyWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  moveConfirmQtyBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.palette.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveConfirmQtyInput: {
    ...typography.headline,
    color: colors.text,
    textAlign: 'center',
    width: 48,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  moveConfirmFooter: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  moveConfirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
  },
  moveConfirmBtnText: {
    ...typography.bodyStrong,
    color: colors.textOnPrimary,
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

  // Label modal
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    ...typography.headline,
    color: colors.text,
  },
  modalClose: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
  modalBody: { flex: 1, padding: spacing.xl, alignItems: 'center' },
  labelBoxName: {
    ...typography.title1,
    color: colors.text,
    marginTop: spacing.sm,
  },
  labelQrWrap: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    ...shadows.md,
  },
  labelCodeWrap: {
    marginTop: spacing.lg,
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  labelCode: {
    fontSize: 11,
    color: colors.textSubtle,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    maxWidth: 280,
  },
  labelCopyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 6,
  },
  labelCopyHint: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
  },
  labelCopyHintActive: { color: colors.success },
  labelHint: {
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primarySubtle,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.xl,
    alignSelf: 'stretch',
  },
  labelHintText: {
    ...typography.footnote,
    color: colors.successText,
    textAlign: 'center',
    lineHeight: 18,
  },
  printBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primarySubtle,
    minWidth: 180,
  },
  printBtnText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '700',
  },
  sharePdfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  sharePdfBtnText: {
    ...typography.footnote,
    color: colors.textMuted,
    fontWeight: '600',
  },
});
