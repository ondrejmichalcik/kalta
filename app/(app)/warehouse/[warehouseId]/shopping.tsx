// ============================================================================
// Kalta – Shopping list (Sprint 6, closes the prepper loop)
// Synced per-warehouse list. "Refresh suggestions" scans expired + below-par
// + coverage gaps and appends new rows (deduped, never resurrects checked
// items). Mark-purchased → restock flow re-stocks into a box via add-items.
// ============================================================================
import { useCallback, useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  addShoppingItem,
  deleteShoppingItem,
  listAllItemsInWarehouse,
  listCustomProducts,
  listShoppingList,
  setShoppingItemChecked,
} from '@/src/lib/supabase';
import { computeLowStock } from '@/src/lib/lowStock';
import { computeKitCoverage } from '@/src/lib/kitCoverage';
import { CATEGORY_LABEL, getExpiryStatus } from '@/src/types/database';
import type { Category, ShoppingListItem, ShoppingSource } from '@/src/types/database';
import { BoxPicker } from '@/src/components/BoxPicker';
import { Icon } from '@/src/components/Icon';
import { colors, radius, spacing, typography } from '@/src/theme';

const SOURCE_LABEL: Record<ShoppingSource, string> = {
  expired: 'Expired',
  low_stock: 'Low stock',
  gap: 'Kit gap',
  manual: 'Manual',
};

const dismissKey = (warehouseId: string) => `@kalta/kit_dismissed_${warehouseId}`;

interface Suggestion {
  label: string;
  category: Category | null;
  source: ShoppingSource;
  source_ref: string | null;
}

export default function ShoppingScreen() {
  const router = useRouter();
  const { warehouseId } = useLocalSearchParams<{ warehouseId: string }>();
  const [list, setList] = useState<ShoppingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [restockItem, setRestockItem] = useState<ShoppingListItem | null>(null);

  const load = useCallback(async () => {
    if (!warehouseId) return;
    try {
      setList(await listShoppingList(warehouseId));
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }, [warehouseId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Active (unchecked) first, then checked at the bottom.
  const sorted = useMemo(() => {
    const active = list.filter((i) => !i.checked);
    const done = list.filter((i) => i.checked);
    return [...active, ...done];
  }, [list]);
  const activeCount = useMemo(() => list.filter((i) => !i.checked).length, [list]);

  const toggleCheck = async (item: ShoppingListItem) => {
    const next = !item.checked;
    setList((prev) => prev.map((x) => (x.id === item.id ? { ...x, checked: next } : x)));
    Haptics.selectionAsync().catch(() => {});
    try {
      await setShoppingItemChecked(item.id, next);
    } catch {
      // revert on failure
      setList((prev) => prev.map((x) => (x.id === item.id ? { ...x, checked: !next } : x)));
    }
  };

  const removeItem = async (item: ShoppingListItem) => {
    setList((prev) => prev.filter((x) => x.id !== item.id));
    try {
      await deleteShoppingItem(item.id);
    } catch {
      load();
    }
  };

  const handleAddManual = () => {
    Alert.prompt(
      'Add to shopping list',
      'What do you need to buy?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add',
          onPress: async (text?: string) => {
            const label = text?.trim();
            if (!label) return;
            try {
              const created = await addShoppingItem({
                warehouse_id: warehouseId!,
                label,
                source: 'manual',
              });
              setList((prev) => [created, ...prev]);
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'Cannot add item.');
            }
          },
        },
      ],
      'plain-text',
    );
  };

  // Scan inventory for things worth buying and append the new ones.
  const handleRefresh = async () => {
    if (!warehouseId) return;
    setRefreshing(true);
    try {
      const [items, customProducts, dismissedRaw] = await Promise.all([
        listAllItemsInWarehouse(warehouseId),
        listCustomProducts(warehouseId).catch(() => []),
        AsyncStorage.getItem(dismissKey(warehouseId)).catch(() => null),
      ]);
      const dismissed = new Set<string>(
        dismissedRaw ? (JSON.parse(dismissedRaw) as string[]) : [],
      );

      const lowStock = computeLowStock(items, customProducts);
      const kit = computeKitCoverage(items, dismissed);

      // Build suggestions keyed by normalized label so expired + below-par of
      // the same product collapse into one row.
      const byLabel = new Map<string, Suggestion>();
      const put = (s: Suggestion) => {
        const key = s.label.trim().toLowerCase();
        if (!key || byLabel.has(key)) return;
        byLabel.set(key, s);
      };

      for (const it of items) {
        if (getExpiryStatus(it.expiry_date) === 'expired') {
          put({ label: it.name, category: it.category, source: 'expired', source_ref: it.barcode ?? it.id });
        }
      }
      for (const it of items) {
        if (lowStock.has(it.id)) {
          put({ label: it.name, category: it.category, source: 'low_stock', source_ref: it.barcode ?? it.id });
        }
      }
      for (const e of kit.entries) {
        if (!e.covered) {
          put({ label: e.item.label, category: e.item.category, source: 'gap', source_ref: e.item.id });
        }
      }

      // Drop anything already on the list (checked or not), matched by label.
      const existing = new Set(list.map((i) => i.label.trim().toLowerCase()));
      const toAdd = [...byLabel.values()].filter((s) => !existing.has(s.label.trim().toLowerCase()));

      if (toAdd.length === 0) {
        Alert.alert('Up to date', 'No new suggestions — your list already covers what needs buying.');
        return;
      }

      const created: ShoppingListItem[] = [];
      for (const s of toAdd) {
        try {
          created.push(
            await addShoppingItem({
              warehouse_id: warehouseId,
              label: s.label,
              category: s.category,
              source: s.source,
              source_ref: s.source_ref,
            }),
          );
        } catch {
          /* skip individual failures */
        }
      }
      if (created.length > 0) {
        setList((prev) => [...created, ...prev]);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Cannot refresh suggestions.');
    } finally {
      setRefreshing(false);
    }
  };

  const handleRowMenu = (item: ShoppingListItem) => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: item.label,
        options: ['Restock into a box', 'Remove from list', 'Cancel'],
        destructiveButtonIndex: 1,
        cancelButtonIndex: 2,
      },
      (idx) => {
        if (idx === 0) setRestockItem(item);
        else if (idx === 1) removeItem(item);
      },
    );
  };

  // Box chosen for restock → jump into add-items prefilled, and pass the
  // shopping row id so it's cleared once items are saved.
  const handleRestockBox = (box: { id: string }) => {
    const item = restockItem;
    setRestockItem(null);
    if (!item || !warehouseId) return;
    router.push({
      pathname: `/warehouse/${warehouseId}/box/${box.id}/add-items` as any,
      params: {
        prefillName: item.label,
        prefillCategory: item.category ?? '',
        shoppingItemId: item.id,
      },
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <Pressable
          hitSlop={12}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.topBarBtn, pressed && { opacity: 0.5 }]}
        >
          <Icon sf="chevron.left" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.topBarTitle}>Shopping list</Text>
        <Pressable
          hitSlop={12}
          onPress={handleAddManual}
          style={({ pressed }) => [styles.topBarBtn, pressed && { opacity: 0.5 }]}
        >
          <Icon sf="plus" size={22} color={colors.primary} />
        </Pressable>
      </View>

      <Pressable
        style={({ pressed }) => [styles.refreshBtn, pressed && { opacity: 0.7 }]}
        onPress={handleRefresh}
        disabled={refreshing}
      >
        {refreshing ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            <Icon sf="arrow.clockwise" size={16} color={colors.primary} />
            <Text style={styles.refreshText}>Refresh suggestions</Text>
          </>
        )}
      </Pressable>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            list.length > 0 ? (
              <Text style={styles.countLine}>
                {activeCount} to buy · {list.length - activeCount} done
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Icon sf="cart" size={48} color={colors.textSubtle} />
              <Text style={styles.emptyTitle}>Nothing to buy</Text>
              <Text style={styles.emptyText}>
                Add items manually, or tap “Refresh suggestions” to pull in expired,
                low-stock, and missing kit items.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <ShoppingRow
              item={item}
              onToggle={() => toggleCheck(item)}
              onMenu={() => handleRowMenu(item)}
            />
          )}
        />
      )}

      <Modal
        visible={!!restockItem}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setRestockItem(null)}
      >
        {restockItem && warehouseId && (
          <BoxPicker
            warehouseId={warehouseId}
            onSelect={handleRestockBox}
            onClose={() => setRestockItem(null)}
          />
        )}
      </Modal>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
function ShoppingRow({
  item,
  onToggle,
  onMenu,
}: {
  item: ShoppingListItem;
  onToggle: () => void;
  onMenu: () => void;
}) {
  return (
    <View style={styles.row}>
      <Pressable hitSlop={8} onPress={onToggle} style={styles.checkBtn}>
        <Icon
          sf={item.checked ? 'checkmark.circle.fill' : 'circle'}
          size={24}
          color={item.checked ? colors.success : colors.textMuted}
        />
      </Pressable>
      <View style={styles.rowBody}>
        <Text
          style={[styles.rowLabel, item.checked && styles.rowLabelChecked]}
          numberOfLines={2}
        >
          {item.label}
        </Text>
        <View style={styles.rowMeta}>
          <Text style={styles.sourceTag}>{SOURCE_LABEL[item.source]}</Text>
          {item.category ? (
            <Text style={styles.catTag}>· {CATEGORY_LABEL[item.category] ?? item.category}</Text>
          ) : null}
        </View>
      </View>
      <Pressable hitSlop={8} onPress={onMenu} style={styles.moreBtn}>
        <Icon sf="ellipsis" size={20} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  topBarBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  topBarTitle: {
    ...typography.headline,
    color: colors.text,
    flex: 1,
    textAlign: 'center',
    marginHorizontal: spacing.sm,
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingVertical: spacing.md,
    backgroundColor: colors.primaryTint,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primarySubtle,
  },
  refreshText: { ...typography.subhead, color: colors.primary, fontWeight: '700' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  countLine: {
    ...typography.footnote,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  checkBtn: { padding: 2 },
  rowBody: { flex: 1, gap: 2 },
  rowLabel: { ...typography.body, color: colors.text, fontWeight: '600' },
  rowLabelChecked: {
    textDecorationLine: 'line-through',
    color: colors.textMuted,
    fontWeight: '400',
  },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sourceTag: { ...typography.caption, color: colors.textMuted, fontWeight: '700' },
  catTag: { ...typography.caption, color: colors.textSubtle },
  moreBtn: { padding: 4 },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: spacing.xxl, gap: spacing.sm },
  emptyTitle: { ...typography.title3, color: colors.text, marginTop: spacing.sm },
  emptyText: { ...typography.subhead, color: colors.textMuted, textAlign: 'center' },
});
