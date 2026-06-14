// ============================================================================
// Kalta – Shopping list (Sprint 6, closes the prepper loop)
// Synced per-warehouse list. "Refresh suggestions" scans expired + below-par
// + coverage gaps and appends new rows (deduped, never resurrects checked
// items). Mark-purchased → restock flow re-stocks into a box via add-items.
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { showPrompt, toast, showActionSheet } from '@/src/lib/feedback';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useGlobalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  addShoppingItem,
  deleteShoppingItem,
  findCustomProduct,
  listAllItemsInWarehouse,
  listChecklistEntries,
  listChecklistSatisfactions,
  listCustomProducts,
  listShoppingList,
  listWarehouseChecklists,
  setShoppingItemChecked,
  subscribeShopping,
} from '@/src/lib/supabase';
import { computeLowStock } from '@/src/lib/lowStock';
import { computeKitCoverage } from '@/src/lib/kitCoverage';
import { ensureSeededChecklists, entryToKitItem, satisfactionsToMaps } from '@/src/lib/checklists';
import { CATEGORY_LABEL, getExpiryStatus } from '@/src/types/database';
import type { Category, Item, ItemWithBox, ShoppingListItem, ShoppingSource } from '@/src/types/database';
import { BoxPicker } from '@/src/components/BoxPicker';
import { Icon } from '@/src/components/Icon';
import { RestockSheet } from '@/src/components/RestockSheet';
import { colors, radius, spacing, typography } from '@/src/theme';

const SOURCE_LABEL: Record<ShoppingSource, string> = {
  expired: 'Expired',
  low_stock: 'Low stock',
  gap: 'Kit gap',
  manual: 'Manual',
  ai: 'AI suggested',
};

// Provenance — why a row is on the list. Prefers a stored reason (AI rows),
// otherwise a concise explanation derived from the source.
function whyText(item: ShoppingListItem): string {
  if (item.reason) return item.reason;
  switch (item.source) {
    case 'expired':
      return 'This item is expired — replace it.';
    case 'low_stock':
      return 'Running low — stock is below your set minimum.';
    case 'gap':
      return 'Missing from your readiness checklist.';
    case 'ai':
      return 'Suggested by AI.';
    default:
      return 'Added manually.';
  }
}

interface Suggestion {
  label: string;
  category: Category | null;
  source: ShoppingSource;
  source_ref: string | null;
}

// Specific = we know the exact product, so restock can pre-fill metadata.
// Generic = open-ended intent ("food", "tools"), so restock needs full add-items.
function isSpecificRow(row: ShoppingListItem): boolean {
  return row.source === 'low_stock' || row.source === 'expired';
}

export default function ShoppingScreen() {
  const router = useRouter();
  // `useGlobalSearchParams` (not Local) because the param lives on the parent
  // [warehouseId] segment — Local wouldn't surface it now that this screen
  // is mounted inside the (tabs) group instead of as a direct stack child.
  const { warehouseId } = useGlobalSearchParams<{ warehouseId: string }>();
  const [list, setList] = useState<ShoppingListItem[]>([]);
  const [items, setItems] = useState<ItemWithBox[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [restockGenericTarget, setRestockGenericTarget] = useState<ShoppingListItem | null>(null);
  const [restockSpecific, setRestockSpecific] = useState<{
    row: ShoppingListItem;
    sourceItem: Item | null;
    typicalExpiryDays: number | null;
  } | null>(null);

  const load = useCallback(async () => {
    if (!warehouseId) return;
    try {
      const [l, i] = await Promise.all([
        listShoppingList(warehouseId),
        listAllItemsInWarehouse(warehouseId),
      ]);
      setList(l);
      setItems(i);
    } catch {
      /* non-fatal */
    }
  }, [warehouseId]);

  // Initial load fires once on mount (and again if warehouseId changes) and
  // is the single owner of the loading spinner — finally guarantees we
  // never get stuck on the spinner even when warehouseId is briefly
  // undefined while route params are being parsed.
  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  // Refresh on every tab focus so check / restock changes made elsewhere
  // (notifications panel, edit sheets) appear immediately.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Live-update the shared list when a peer checks off / adds in the store.
  useEffect(() => {
    if (!warehouseId) return;
    return subscribeShopping(warehouseId, () => load());
  }, [warehouseId, load]);

  // Two-section partition: unchecked = still to buy, checked = bought and
  // waiting to be restocked into the warehouse.
  const toBuy = useMemo(() => list.filter((i) => !i.checked), [list]);
  const toRestock = useMemo(() => list.filter((i) => i.checked), [list]);

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
    showPrompt(
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
              toast.error(e?.message ?? 'Cannot add item.');
            }
          },
        },
      ],
    );
  };

  // Scan inventory for things worth buying and append the new ones.
  const handleRefresh = async () => {
    if (!warehouseId) return;
    setRefreshing(true);
    try {
      const [items, customProducts, checklists, links, sats] = await Promise.all([
        listAllItemsInWarehouse(warehouseId),
        listCustomProducts(warehouseId).catch(() => []),
        ensureSeededChecklists(warehouseId),
        listWarehouseChecklists(warehouseId).catch(() => []),
        listChecklistSatisfactions(warehouseId).catch(() => []),
      ]);

      // Kit gaps come from the warehouse's active DB checklists (same source as
      // the readiness screen) — linked lists, or all when nothing is linked.
      const linkedIds = new Set(links.map((l) => l.checklist_id));
      const activeIds = checklists
        .filter((c) => linkedIds.size === 0 || linkedIds.has(c.id))
        .map((c) => c.id);
      const entryLists = await Promise.all(activeIds.map((id) => listChecklistEntries(id)));
      const entries = entryLists.flat();
      const entryIds = new Set(entries.map((e) => e.id));
      const { overrides, pins } = satisfactionsToMaps(
        sats.filter((s) => entryIds.has(s.checklist_entry_id)),
      );

      const lowStock = computeLowStock(items, customProducts);
      const kit = computeKitCoverage(items, overrides, [], {
        entries: entries.map(entryToKitItem),
        pins,
      });

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
        // Only truly missing entries become new gap suggestions — skip
        // not_applicable (irrelevant here), partial/stocked, and rows already
        // on the list (on_list / purchased).
        if (e.state === 'missing') {
          put({ label: e.item.label, category: e.item.category, source: 'gap', source_ref: e.item.id });
        }
      }

      // Drop anything already on the list (checked or not), matched by label.
      const existing = new Set(list.map((i) => i.label.trim().toLowerCase()));
      const toAdd = [...byLabel.values()].filter((s) => !existing.has(s.label.trim().toLowerCase()));

      if (toAdd.length === 0) {
        toast.info('No new suggestions — your list already covers what needs buying.');
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
      toast.error(e?.message ?? 'Cannot refresh suggestions.');
    } finally {
      setRefreshing(false);
    }
  };

  const handleRowMenu = (item: ShoppingListItem) => {
    // Buy-section row: just toggle / remove. Restock action lives as a
    // primary button on the restock-section rows.
    const options = item.checked
      ? ['Move back to To buy', 'Why is this here?', 'Remove from list', 'Cancel']
      : ['Mark as purchased', 'Why is this here?', 'Remove from list', 'Cancel'];
    showActionSheet(
      {
        title: item.label,
        message: SOURCE_LABEL[item.source],
        options,
        destructiveButtonIndex: 2,
        cancelButtonIndex: 3,
      },
      (idx) => {
        if (idx === 0) toggleCheck(item);
        else if (idx === 1) toast.info(whyText(item));
        else if (idx === 2) removeItem(item);
      },
    );
  };

  // Primary "Restock" action on a checked row. Specific rows open the
  // lightweight RestockSheet with pre-fill; generic rows go to add-items.
  const handleRestockTap = async (row: ShoppingListItem) => {
    if (!warehouseId) return;
    if (isSpecificRow(row)) {
      // Try to resolve the original product so we can clone metadata.
      // source_ref is either a barcode or the original item.id.
      const sourceItem =
        items.find(
          (i) =>
            (row.source_ref != null && i.barcode === row.source_ref) ||
            (row.source_ref != null && i.id === row.source_ref),
        ) ?? null;
      let typicalExpiryDays: number | null = null;
      if (sourceItem?.barcode) {
        const cp = await findCustomProduct(warehouseId, sourceItem.barcode).catch(() => null);
        typicalExpiryDays = cp?.typical_expiry_days ?? null;
      }
      setRestockSpecific({ row, sourceItem, typicalExpiryDays });
    } else {
      // Generic intent — open box picker, then add-items prefilled with the
      // shopping context. Row clears when at least one item is saved.
      setRestockGenericTarget(row);
    }
  };

  // Generic row: box chosen → jump to add-items with shopping context.
  const handleGenericBox = (box: { id: string }) => {
    const row = restockGenericTarget;
    setRestockGenericTarget(null);
    if (!row || !warehouseId) return;
    router.push({
      pathname: `/warehouse/${warehouseId}/box/${box.id}/add-items` as any,
      params: {
        prefillName: row.label,
        prefillCategory: row.category ?? '',
        shoppingItemId: row.id,
      },
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          hitSlop={12}
          onPress={() => router.push('/' as any)}
          style={({ pressed }) => [styles.topBarBtn, pressed && { opacity: 0.5 }]}
          accessibilityLabel="Back to warehouses"
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
        <SectionList
          sections={[
            { title: 'To buy', data: toBuy, kind: 'buy' as const },
            { title: 'Ready to restock', data: toRestock, kind: 'restock' as const },
          ].filter((s) => s.data.length > 0)}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.listContent}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>{section.title}</Text>
              <Text style={styles.sectionCount}>{section.data.length}</Text>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Icon sf="cart" size={48} color={colors.textSubtle} />
              <Text style={styles.emptyTitle}>Nothing to buy</Text>
              <Text style={styles.emptyText}>
                Add items manually, or tap "Refresh suggestions" to pull in expired,
                low-stock, and missing kit items.
              </Text>
            </View>
          }
          renderItem={({ item, section }) =>
            section.kind === 'buy' ? (
              <BuyRow
                item={item}
                onToggle={() => toggleCheck(item)}
                onMenu={() => handleRowMenu(item)}
              />
            ) : (
              <RestockRow
                item={item}
                specific={isSpecificRow(item)}
                onRestock={() => handleRestockTap(item)}
                onMenu={() => handleRowMenu(item)}
              />
            )
          }
          stickySectionHeadersEnabled={false}
        />
      )}

      {/* Generic-row box picker → forwards to add-items */}
      <Modal
        visible={!!restockGenericTarget}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setRestockGenericTarget(null)}
      >
        {restockGenericTarget && warehouseId && (
          <BoxPicker
            warehouseId={warehouseId}
            onSelect={handleGenericBox}
            onClose={() => setRestockGenericTarget(null)}
          />
        )}
      </Modal>

      {/* Specific-row lightweight restock sheet */}
      {restockSpecific && warehouseId && (
        <RestockSheet
          visible={!!restockSpecific}
          warehouseId={warehouseId}
          shoppingItem={restockSpecific.row}
          sourceItem={restockSpecific.sourceItem}
          typicalExpiryDays={restockSpecific.typicalExpiryDays}
          onClose={() => setRestockSpecific(null)}
          onRestocked={() => {
            setRestockSpecific(null);
            load();
          }}
        />
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Row for the "To buy" section — checkbox toggles purchased state.
function BuyRow({
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
        <Icon sf="circle" size={24} color={colors.textMuted} />
      </Pressable>
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel} numberOfLines={2}>
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

// Row for the "Ready to restock" section — bag icon + primary Restock CTA.
// Specific rows say "Restock" (lightweight sheet), generic say "Add items for X"
// to set expectation that user will be adding concrete products.
function RestockRow({
  item,
  specific,
  onRestock,
  onMenu,
}: {
  item: ShoppingListItem;
  specific: boolean;
  onRestock: () => void;
  onMenu: () => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.bagBadge}>
        <Icon sf="bag.fill" size={16} color={colors.success} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel} numberOfLines={2}>
          {item.label}
        </Text>
        <View style={styles.rowMeta}>
          <Text style={styles.sourceTag}>{SOURCE_LABEL[item.source]}</Text>
          {item.category ? (
            <Text style={styles.catTag}>· {CATEGORY_LABEL[item.category] ?? item.category}</Text>
          ) : null}
        </View>
      </View>
      <Pressable
        hitSlop={6}
        onPress={onRestock}
        style={({ pressed }) => [styles.restockBtn, pressed && { opacity: 0.7 }]}
      >
        <Icon
          sf={specific ? 'tray.and.arrow.down.fill' : 'plus.app.fill'}
          size={14}
          color={colors.textOnPrimary}
        />
        <Text style={styles.restockBtnText} numberOfLines={1}>
          {specific ? 'Restock' : 'Add items'}
        </Text>
      </Pressable>
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
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  sectionHeaderText: {
    ...typography.label,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionCount: { ...typography.footnote, color: colors.textSubtle, fontWeight: '700' },
  bagBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.successBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  restockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  restockBtnText: { ...typography.footnote, color: colors.textOnPrimary, fontWeight: '700' },
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
