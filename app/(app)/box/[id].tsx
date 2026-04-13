// ============================================================================
// Stockr – Box detail
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
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Swipeable } from 'react-native-gesture-handler';
import QRCode from 'react-native-qrcode-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { ItemEditSheet } from '@/src/components/ItemEditSheet';
import { BoxEditSheet } from '@/src/components/BoxEditSheet';
import { Icon } from '@/src/components/Icon';
import { Card } from '@/src/components/Card';
import { FAB } from '@/src/components/FAB';
import { StatusDot } from '@/src/components/StatusDot';
import {
  deleteBox,
  deleteItem,
  getBoxById,
  listItems,
  subscribeItems,
} from '@/src/lib/supabase';
import type { Box, Item, Category } from '@/src/types/database';
import {
  EXPIRY_COLORS,
  formatExpiry,
  getExpiryStatus,
} from '@/src/types/database';
import { colors, radius, shadows, spacing, typography } from '@/src/theme';
import type { SFSymbolName } from '@/src/components/Icon';

type ViewMode = 'list' | 'grid';
const VIEW_MODE_KEY = 'stockr:boxViewMode';

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
  const { id } = useLocalSearchParams<{ id: string }>();
  const [box, setBox] = useState<Box | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showLabel, setShowLabel] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [error, setError] = useState<string | null>(null);

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
    } catch (e: any) {
      setError(e?.message ?? 'Cannot load box.');
      throw e;
    }
  }, [id]);

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
              router.replace('/' as any);
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'Cannot delete.');
            }
          },
        },
      ],
    );
  };

  const showBoxActionSheet = () => {
    const options = ['Show QR label', 'Edit box', 'Delete box', 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options,
        destructiveButtonIndex: 2,
        cancelButtonIndex: 3,
        title: box?.name ?? undefined,
      },
      (idx) => {
        if (idx === 0) setShowLabel(true);
        else if (idx === 1) setShowEdit(true);
        else if (idx === 2) handleDeleteBox();
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
            onPress={() => router.replace('/' as any)}
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
            onPress={() => router.replace('/' as any)}
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
        data={items}
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
          viewMode === 'list' ? (
            <SwipeableRow
              item={item}
              onPress={() => setEditingItem(item)}
              onDelete={(close) => confirmDelete(item, close)}
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

      <FAB
        label="Add items"
        sfIcon="plus"
        bottom={24}
        onPress={() => router.push(`/box/${box.id}/add-items` as any)}
      />

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
        {editingItem && (
          <ItemEditSheet
            item={editingItem}
            onClose={() => setEditingItem(null)}
            onSaved={(updated) => {
              setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
              setEditingItem(null);
            }}
            onDeleted={(itemId) => {
              setItems((prev) => prev.filter((x) => x.id !== itemId));
              setEditingItem(null);
            }}
          />
        )}
      </Modal>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// LabelModalContent
// ---------------------------------------------------------------------------

function LabelModalContent({ box, onClose }: { box: Box; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

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
          <QRCode value={box.qr_code} size={220} backgroundColor="#FFFFFF" />
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

        <Pressable style={styles.printBtn} disabled>
          <Icon sf="printer" size={18} color={colors.textSubtle} />
          <Text style={styles.printBtnText}>Print (Sprint 3)</Text>
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
  registerOpen,
}: {
  item: Item;
  onPress: () => void;
  onDelete: (close: () => void) => void;
  registerOpen: (ref: Swipeable | null) => void;
}) {
  const status = getExpiryStatus(item.expiry_date);
  const palette =
    status === 'none'
      ? { bg: colors.expiryNoneBg, fg: colors.expiryNoneText }
      : EXPIRY_COLORS[status];
  const sfIcon: SFSymbolName = item.category ? CATEGORY_SF[item.category] : 'shippingbox.fill';
  const swipeRef = useRef<Swipeable>(null);

  const renderRightActions = () => (
    <Pressable
      style={styles.deleteAction}
      onPress={() => onDelete(() => swipeRef.current?.close())}
    >
      <Icon sf="trash.fill" size={20} color="#FFFFFF" />
      <Text style={styles.deleteActionText}>Delete</Text>
    </Pressable>
  );

  return (
    <View style={styles.rowWrap}>
      <Swipeable
        ref={swipeRef}
        renderRightActions={renderRightActions}
        rightThreshold={40}
        overshootRight={false}
        onSwipeableWillOpen={() => registerOpen(swipeRef.current)}
      >
        <Card onPress={onPress} style={styles.row}>
          <StatusDot status={status} />
          <View style={styles.rowBody}>
            <Text style={styles.rowName} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.rowQty} numberOfLines={1}>
              {formatQuantity(item.quantity, item.unit)}
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
            <Image source={{ uri: item.image_url }} style={styles.rowThumb} />
          ) : (
            <Icon sf={sfIcon} size={20} color={colors.textMuted} />
          )}
        </Card>
      </Swipeable>
    </View>
  );
}

function formatQuantity(qty: number, unit: string): string {
  const n = Number.isInteger(qty) ? qty.toString() : qty.toFixed(1);
  return `${n} ${unit}`;
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
          <Image source={{ uri: item.image_url }} style={styles.gridImage} />
        ) : (
          <Icon sf={sfIcon} size={36} color={colors.textMuted} />
        )}
      </View>
      <Text numberOfLines={2} style={styles.gridName}>
        {item.name}
      </Text>
      <Text style={styles.gridQty}>{formatQuantity(item.quantity, item.unit)}</Text>
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
  rowName: {
    ...typography.headline,
    color: colors.text,
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

  // Swipe delete action
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
    gap: spacing.sm,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.palette.neutral[100],
    opacity: 0.7,
  },
  printBtnText: {
    ...typography.body,
    color: colors.textSubtle,
    fontWeight: '600',
  },
});
