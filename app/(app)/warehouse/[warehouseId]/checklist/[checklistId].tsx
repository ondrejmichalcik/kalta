// ============================================================================
// Kalta – Checklist detail / editor (Sprint 7)
// One checklist: coverage chips per entry (reusing the shared matcher), entry
// CRUD, per-entry actions (pin to an item, override, add to shopping), and the
// optional AI smart match. Works for both the FEMA seed and custom lists.
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  addShoppingItem,
  deleteChecklist,
  deleteChecklistEntry,
  getWarehouseById,
  listAllItemsInWarehouse,
  listChecklistEntries,
  listChecklistSatisfactions,
  listChecklists,
  listHouseholdMembers,
  listShoppingList,
  setChecklistSatisfaction,
  subscribeChecklists,
  updateChecklistEntry,
} from '@/src/lib/supabase';
import { computeReadiness } from '@/src/lib/readiness';
import { computeKitCoverage, type KitCoverageEntry } from '@/src/lib/kitCoverage';
import { addAddonToChecklist, entryToKitItem, satisfactionsToMaps } from '@/src/lib/checklists';
import type { KitAddon } from '@/src/data/emergencyKit';
import { hasAnthropicKey } from '@/src/lib/vision';
import { suggestKitMatches } from '@/src/lib/kitMatch';
import { AiProposalSheet } from '@/src/components/AiProposalSheet';
import type { AiProposal } from '@/src/lib/aiProposal';
import { getExpiryStatus } from '@/src/types/database';
import type {
  ChecklistEntry,
  HouseholdMember,
  ItemWithBox,
  ShoppingListItem,
} from '@/src/types/database';
import { colors, radius, shadows, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';
import { ChecklistEntrySheet } from '@/src/components/ChecklistEntrySheet';
import { ChecklistSheet } from '@/src/components/ChecklistSheet';
import { PackPickerSheet } from '@/src/components/PackPickerSheet';

function chipVisual(state: KitCoverageEntry['state']): {
  bg: string;
  border: string;
  fg: string;
  icon: Parameters<typeof Icon>[0]['sf'];
} {
  switch (state) {
    case 'stocked':
      return { bg: colors.successBg, border: colors.successBgStrong, fg: colors.successText, icon: 'checkmark.circle.fill' };
    case 'purchased':
      return { bg: colors.warningBg, border: colors.warningBgStrong, fg: colors.warningText, icon: 'bag.fill' };
    case 'on_list':
      return { bg: colors.primaryTint, border: colors.primarySubtle, fg: colors.primary, icon: 'cart.fill' };
    case 'partial':
      return { bg: colors.warningBg, border: colors.warningBgStrong, fg: colors.warningText, icon: 'circle.lefthalf.filled' };
    default:
      return { bg: colors.dangerBg, border: colors.dangerBgStrong, fg: colors.dangerText, icon: 'plus.circle' };
  }
}

export default function ChecklistDetailScreen() {
  const router = useRouter();
  const { warehouseId, checklistId } = useLocalSearchParams<{
    warehouseId: string;
    checklistId: string;
  }>();

  const [name, setName] = useState('');
  const [isSeed, setIsSeed] = useState(false);
  const [entries, setEntries] = useState<ChecklistEntry[]>([]);
  const [items, setItems] = useState<ItemWithBox[]>([]);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [shoppingList, setShoppingList] = useState<ShoppingListItem[]>([]);
  const [goalDays, setGoalDays] = useState(14);
  const [overrides, setOverrides] = useState<Map<string, string>>(new Map());
  const [pins, setPins] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [matching, setMatching] = useState(false);
  const [pinTarget, setPinTarget] = useState<ChecklistEntry | null>(null);
  const [pinQuery, setPinQuery] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorEntry, setEditorEntry] = useState<ChecklistEntry | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [packPickerOpen, setPackPickerOpen] = useState(false);
  const [aiProposal, setAiProposal] = useState<AiProposal | null>(null);
  const [aiProposalOpen, setAiProposalOpen] = useState(false);

  const load = useCallback(async () => {
    if (!warehouseId || !checklistId) return;
    hasAnthropicKey().then(setAiEnabled).catch(() => {});
    try {
      const [lists, ents, sats, rows, mem, wh, shop] = await Promise.all([
        listChecklists(warehouseId),
        listChecklistEntries(checklistId),
        listChecklistSatisfactions(warehouseId),
        listAllItemsInWarehouse(warehouseId),
        listHouseholdMembers(warehouseId),
        getWarehouseById(warehouseId),
        listShoppingList(warehouseId).catch(() => [] as ShoppingListItem[]),
      ]);
      const cl = lists.find((l) => l.id === checklistId);
      setName(cl?.name ?? 'Checklist');
      setIsSeed(cl?.is_seed ?? false);
      setEntries(ents);
      setItems(rows);
      setMembers(mem);
      setShoppingList(shop);
      setGoalDays(wh?.readiness_goal_days ?? 14);
      // Satisfactions are warehouse-scoped — keep only this checklist's entries.
      const entryIds = new Set(ents.map((e) => e.id));
      const { overrides: ov, pins: pn } = satisfactionsToMaps(
        sats.filter((s) => entryIds.has(s.checklist_entry_id)),
      );
      setOverrides(ov as Map<string, string>);
      setPins(pn);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }, [warehouseId, checklistId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    if (!warehouseId) return;
    return subscribeChecklists(warehouseId, () => load());
  }, [warehouseId, load]);

  const kitItems = useMemo(() => entries.map(entryToKitItem), [entries]);
  const overrideMap = overrides as Map<string, any>;

  // Two-pass like the readiness screen: detect water filter (entry seeded as
  // 'water-filter') for computeReadiness, then final coverage with days.
  const prelim = useMemo(
    () => computeKitCoverage(items, overrideMap, shoppingList, { entries: kitItems, pins }),
    [items, overrideMap, shoppingList, kitItems, pins],
  );
  const hasWaterFilter = useMemo(() => {
    const wfEntry = entries.find((e) => e.seed_key === 'water-filter');
    if (!wfEntry) return false;
    return prelim.entries.some((c) => c.item.id === wfEntry.id && c.covered);
  }, [entries, prelim]);
  const result = useMemo(
    () => computeReadiness(items, members, { hasWaterFilter }),
    [items, members, hasWaterFilter],
  );
  const kit = useMemo(
    () =>
      computeKitCoverage(items, overrideMap, shoppingList, {
        entries: kitItems,
        pins,
        readiness: result,
        goalDays,
      }),
    [items, overrideMap, shoppingList, kitItems, pins, result, goalDays],
  );

  const setSat = async (entryId: string, mode: string | null, itemId?: string | null) => {
    if (!warehouseId) return;
    try {
      await setChecklistSatisfaction({
        checklist_entry_id: entryId,
        warehouse_id: warehouseId,
        mode: mode as any,
        item_id: itemId ?? null,
      });
      load();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not update.');
    }
  };

  const pinToItem = (entry: ChecklistEntry) => {
    const usable = items.filter((i) => getExpiryStatus(i.expiry_date) !== 'expired');
    if (usable.length === 0) {
      Alert.alert('No items', 'There are no inventory items to pin.');
      return;
    }
    // Open a searchable modal (no item-count cap) instead of an ActionSheet.
    setPinQuery('');
    setPinTarget(entry);
  };

  const usableItemsForPin = useMemo(
    () => items.filter((i) => getExpiryStatus(i.expiry_date) !== 'expired'),
    [items],
  );
  const pinResults = useMemo(() => {
    const q = pinQuery.trim().toLowerCase();
    const list = q
      ? usableItemsForPin.filter(
          (i) => i.name.toLowerCase().includes(q) || i.box_name.toLowerCase().includes(q),
        )
      : usableItemsForPin;
    return list.slice(0, 100);
  }, [usableItemsForPin, pinQuery]);

  const openEditor = (entry: ChecklistEntry | null) => {
    setEditorEntry(entry);
    setEditorOpen(true);
  };

  // Reorder by swapping sort_order with the adjacent entry (within the list's
  // current order). Cheap stand-in for drag-to-reorder.
  const moveEntry = async (entryId: string, dir: 'up' | 'down') => {
    const idx = entries.findIndex((e) => e.id === entryId);
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= entries.length) return;
    const a = entries[idx];
    const b = entries[swapIdx];
    try {
      await updateChecklistEntry(a.id, { sort_order: b.sort_order });
      await updateChecklistEntry(b.id, { sort_order: a.sort_order });
      load();
    } catch {
      /* non-fatal */
    }
  };

  const deleteEntry = (entry: ChecklistEntry) => {
    Alert.alert('Delete item', `Remove "${entry.label}" from this checklist?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteChecklistEntry(entry.id).then(load).catch(() => {}),
      },
    ]);
  };

  const handleEntryPress = (cov: KitCoverageEntry) => {
    const entry = entries.find((e) => e.id === cov.item.id);
    if (!entry) return;
    const override = overrides.get(entry.id) ?? null;
    const opts: { label: string; run: () => void; destructive?: boolean }[] = [];

    opts.push({ label: 'Pin to an item…', run: () => pinToItem(entry) });
    if (cov.state !== 'stocked') {
      opts.push({
        label: 'Add to shopping list',
        run: () =>
          addShoppingItem({
            warehouse_id: warehouseId!,
            label: entry.label,
            category: entry.category,
            source: 'gap',
            source_ref: entry.seed_key ?? entry.id,
          })
            .then(load)
            .catch((e: any) => Alert.alert('Error', e?.message ?? 'Cannot add.')),
      });
      opts.push({ label: 'I have this', run: () => setSat(entry.id, 'force_stocked') });
    }
    if (override === 'not_applicable') {
      opts.push({ label: 'Make relevant again', run: () => setSat(entry.id, null) });
    } else {
      opts.push({ label: 'Not relevant here', run: () => setSat(entry.id, 'not_applicable') });
    }
    if (override != null || pins.has(entry.id)) {
      opts.push({ label: 'Reset to auto-detect', run: () => setSat(entry.id, null) });
    }
    opts.push({ label: 'Edit…', run: () => openEditor(entry) });
    opts.push({ label: 'Move up', run: () => moveEntry(entry.id, 'up') });
    opts.push({ label: 'Move down', run: () => moveEntry(entry.id, 'down') });
    opts.push({ label: 'Delete item', run: () => deleteEntry(entry), destructive: true });

    const labels = opts.map((o) => o.label);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: entry.label,
        message: cov.matchedItem ? `Matched: "${cov.matchedItem.name}"` : entry.rationale || undefined,
        options: [...labels, 'Cancel'],
        cancelButtonIndex: labels.length,
        destructiveButtonIndex: opts.findIndex((o) => o.destructive),
      },
      (idx) => {
        if (idx != null && idx < opts.length) opts[idx].run();
      },
    );
  };

  const addEntry = () => openEditor(null);

  const removeChecklist = () => {
    if (!checklistId) return;
    Alert.alert('Delete checklist', `Delete "${name}" and all its items?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          deleteChecklist(checklistId)
            .then(() => router.back())
            .catch((e: any) => Alert.alert('Error', e?.message ?? 'Could not delete.')),
      },
    ]);
  };

  const addPack = (pack: KitAddon) => {
    if (!warehouseId || !checklistId) return;
    addAddonToChecklist(warehouseId, checklistId, pack)
      .then(load)
      .catch((e: any) => Alert.alert('Error', e?.message ?? 'Could not add pack.'));
  };

  // Manage menu in the header (consistent with box detail's ⋯ pattern). Seed
  // (FEMA) can be renamed but not deleted — it's hidden via the toggle on the
  // Checklists list instead.
  const openManageMenu = () => {
    const opts: { label: string; run: () => void; destructive?: boolean }[] = [
      { label: 'Add from a pack…', run: () => setPackPickerOpen(true) },
      { label: 'Rename', run: () => setRenameOpen(true) },
    ];
    if (!isSeed) opts.push({ label: 'Delete checklist', run: removeChecklist, destructive: true });
    const labels = opts.map((o) => o.label);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: name,
        options: [...labels, 'Cancel'],
        cancelButtonIndex: labels.length,
        destructiveButtonIndex: opts.findIndex((o) => o.destructive),
      },
      (idx) => {
        if (idx != null && idx < opts.length) opts[idx].run();
      },
    );
  };

  const applyAiProposal = async (edited: AiProposal) => {
    if (edited.kind !== 'pins' || !warehouseId) return;
    for (const m of edited.matches) {
      await setChecklistSatisfaction({
        checklist_entry_id: m.entryId,
        warehouse_id: warehouseId,
        mode: 'pin',
        item_id: m.itemId,
      }).catch(() => {});
    }
    load();
  };

  const runSmartMatch = () => {
    const targets = kit.entries.filter(
      (e) => e.applicable && (overrides.get(e.item.id) ?? null) == null && e.state !== 'stocked',
    );
    const usableItems = items
      .filter((i) => getExpiryStatus(i.expiry_date) !== 'expired')
      .map((i) => ({ id: i.id, name: i.name }));
    if (targets.length === 0) {
      Alert.alert('Nothing to match', 'Every item is already covered or decided.');
      return;
    }
    if (usableItems.length === 0) {
      Alert.alert('No items', 'There are no inventory items to match against.');
      return;
    }
    Alert.alert(
      'Smart match',
      `Send ${usableItems.length} item ${usableItems.length === 1 ? 'name' : 'names'} to Anthropic to suggest matches? This uses your API key.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Match',
          onPress: async () => {
            setMatching(true);
            try {
              const proposal = await suggestKitMatches(
                targets.map((e) => ({ id: e.item.id, label: e.item.label, rationale: e.item.rationale })),
                usableItems,
              );
              if (proposal.kind !== 'pins' || proposal.matches.length === 0) {
                Alert.alert('No matches', 'Claude found no confident matches.');
                return;
              }
              setAiProposal(proposal);
              setAiProposalOpen(true);
            } catch (e: any) {
              Alert.alert('Smart match failed', e?.message ?? 'Could not reach Claude.');
            } finally {
              setMatching(false);
            }
          },
        },
      ],
    );
  };

  // Group coverage entries by their group, preserving order.
  const groups = useMemo(() => {
    const out: { name: string; entries: KitCoverageEntry[] }[] = [];
    for (const e of kit.entries) {
      let g = out.find((x) => x.name === e.item.group);
      if (!g) {
        g = { name: e.item.group, entries: [] };
        out.push(g);
      }
      g.entries.push(e);
    }
    return out;
  }, [kit]);

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
        <Text style={styles.topBarTitle} numberOfLines={1}>{name}</Text>
        <Pressable
          hitSlop={12}
          onPress={addEntry}
          style={({ pressed }) => [styles.topBarBtn, pressed && { opacity: 0.5 }]}
        >
          <Icon sf="plus" size={22} color={colors.primary} />
        </Pressable>
        <Pressable
          hitSlop={12}
          onPress={openManageMenu}
          style={({ pressed }) => [styles.topBarBtn, pressed && { opacity: 0.5 }]}
        >
          <Icon sf="ellipsis" size={22} color={colors.text} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.countRow}>
            <Text style={styles.countText}>
              {kit.coveredCount}/{kit.total} covered
            </Text>
          </View>

          {groups.map((g) => (
            <View key={g.name} style={styles.group}>
              <Text style={styles.groupLabel}>{g.name}</Text>
              <View style={styles.rowWrap}>
                {g.entries.map((e) => {
                  const v = chipVisual(e.state);
                  return (
                    <Pressable
                      key={e.item.id}
                      onPress={() => handleEntryPress(e)}
                      style={({ pressed }) => [
                        styles.chip,
                        { backgroundColor: v.bg, borderColor: v.border },
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Icon sf={v.icon} size={14} color={v.fg} />
                      <Text
                        style={[
                          styles.chipText,
                          { color: v.fg },
                          (overrides.get(e.item.id) ?? null) != null && styles.chipOverridden,
                        ]}
                      >
                        {e.item.label}
                        {e.state === 'partial' && e.days != null ? ` · ${Math.floor(e.days)}d` : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}

          {entries.length === 0 && (
            <Text style={styles.empty}>No items yet. Tap + to add what this list should track.</Text>
          )}

          {aiEnabled && entries.length > 0 && (
            <Pressable
              style={({ pressed }) => [styles.smartBtn, pressed && { opacity: 0.7 }]}
              onPress={runSmartMatch}
              disabled={matching}
            >
              {matching ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <Icon sf="sparkles" size={15} color={colors.primary} />
              )}
              <Text style={styles.smartText}>{matching ? 'Matching…' : 'Smart match with AI'}</Text>
            </Pressable>
          )}
        </ScrollView>
      )}

      <ChecklistEntrySheet
        visible={editorOpen}
        entry={editorEntry}
        checklistId={checklistId ?? ''}
        warehouseId={warehouseId ?? ''}
        sortOrder={entries.length}
        onClose={() => setEditorOpen(false)}
        onSaved={load}
      />

      <ChecklistSheet
        visible={renameOpen}
        mode="rename"
        warehouseId={warehouseId ?? ''}
        checklist={checklistId ? { id: checklistId, name } : null}
        onClose={() => setRenameOpen(false)}
        onRenamed={(n) => setName(n)}
      />

      <PackPickerSheet
        visible={packPickerOpen}
        presentSeedKeys={new Set(entries.map((e) => e.seed_key).filter(Boolean) as string[])}
        onAdd={addPack}
        onClose={() => setPackPickerOpen(false)}
      />

      <AiProposalSheet
        visible={aiProposalOpen}
        proposal={aiProposal}
        title="Smart match"
        onConfirm={applyAiProposal}
        onClose={() => setAiProposalOpen(false)}
      />

      <Modal
        visible={pinTarget != null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPinTarget(null)}
      >
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <View style={styles.topBar}>
            <Pressable
              hitSlop={12}
              onPress={() => setPinTarget(null)}
              style={({ pressed }) => [styles.topBarBtn, pressed && { opacity: 0.5 }]}
            >
              <Icon sf="xmark" size={20} color={colors.text} />
            </Pressable>
            <Text style={styles.topBarTitle} numberOfLines={1}>
              {pinTarget ? `Fulfilled by — ${pinTarget.label}` : 'Fulfilled by'}
            </Text>
            <View style={styles.topBarBtn} />
          </View>
          <View style={styles.searchWrap}>
            <Icon sf="magnifyingglass" size={16} color={colors.textMuted} />
            <TextInput
              value={pinQuery}
              onChangeText={setPinQuery}
              placeholder="Search items…"
              placeholderTextColor={colors.textSubtle}
              style={styles.searchInput}
              autoCorrect={false}
            />
          </View>
          <ScrollView contentContainerStyle={styles.pinList} keyboardShouldPersistTaps="handled">
            {pinResults.map((it) => (
              <Pressable
                key={it.id}
                style={({ pressed }) => [styles.pinRow, pressed && { opacity: 0.6 }]}
                onPress={() => {
                  if (pinTarget) setSat(pinTarget.id, 'pin', it.id);
                  setPinTarget(null);
                }}
              >
                <Icon sf="shippingbox.fill" size={16} color={colors.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pinName} numberOfLines={1}>{it.name}</Text>
                  <Text style={styles.pinBox} numberOfLines={1}>{it.box_name}</Text>
                </View>
              </Pressable>
            ))}
            {pinResults.length === 0 && (
              <Text style={styles.empty}>No matching items.</Text>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

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
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  countRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  countText: { ...typography.subhead, color: colors.text, fontWeight: '800' },
  group: { gap: spacing.xs + 2 },
  groupLabel: { ...typography.label, color: colors.textMuted },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  chipText: { ...typography.footnote, fontWeight: '600' },
  chipOverridden: { textDecorationLine: 'line-through', opacity: 0.7 },
  empty: { ...typography.subhead, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl },
  smartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.primarySubtle,
    backgroundColor: colors.primaryTint,
  },
  smartText: { ...typography.subhead, color: colors.primary, fontWeight: '700' },


  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  searchInput: { ...typography.body, color: colors.text, flex: 1, padding: 0 },
  pinList: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xs + 2 },
  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  pinName: { ...typography.body, color: colors.text, fontWeight: '600' },
  pinBox: { ...typography.footnote, color: colors.textMuted, marginTop: 1 },
});
