// ============================================================================
// Kalta – Readiness detail screen (Sprint 6)
// Weakest-link headline + per-category coverage bars (food / water) measured
// against the warehouse readiness goal. Surfaces uncounted items and the
// household needs that drive the math. Goal + members are managed in
// warehouse settings (HOUSEHOLD section).
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
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
  getWarehouseById,
  listAllItemsInWarehouse,
  listChecklistEntries,
  listChecklistSatisfactions,
  listHouseholdMembers,
  listShoppingList,
  listWarehouseChecklists,
  setChecklistSatisfaction,
  subscribeChecklists,
  subscribeHousehold,
} from '@/src/lib/supabase';
import { computeReadiness, type ReadinessResult } from '@/src/lib/readiness';
import { computeKitCoverage, type KitCoverageEntry, type KitOverride } from '@/src/lib/kitCoverage';
import { ensureSeededChecklists, entryToKitItem, satisfactionsToMaps } from '@/src/lib/checklists';
import { hasAnthropicKey } from '@/src/lib/vision';
import { suggestKitMatches } from '@/src/lib/kitMatch';
import { analyzeReadiness } from '@/src/lib/advisor';
import { updateReadinessWidget } from '@/src/lib/widget';
import { AiProposalSheet } from '@/src/components/AiProposalSheet';
import type { AiProposal } from '@/src/lib/aiProposal';
import { getExpiryStatus } from '@/src/types/database';
import type { ChecklistEntry, HouseholdMember, ItemWithBox, ShoppingListItem } from '@/src/types/database';
import { colors, radius, shadows, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';
import { CATEGORY_SF } from '@/src/components/categoryIcons';
import { toast, showAlert, showActionSheet } from '@/src/lib/feedback';

type Tone = 'red' | 'amber' | 'green';

function toneFor(ratio: number): Tone {
  return ratio >= 1 ? 'green' : ratio >= 0.25 ? 'amber' : 'red';
}

const TONE_COLOR: Record<Tone, string> = {
  red: colors.danger,
  amber: colors.warning,
  green: colors.success,
};

function formatDays(days: number): string {
  if (days < 1) return '<1 day';
  const d = Math.floor(days);
  return `${d} ${d === 1 ? 'day' : 'days'}`;
}

function goalLabel(days: number): string {
  if (days === 3) return '72 hours';
  if (days === 14) return '2 weeks';
  if (days === 30) return '1 month';
  if (days === 90) return '3 months';
  return `${days} days`;
}

export default function ReadinessScreen() {
  const router = useRouter();
  const { warehouseId } = useLocalSearchParams<{ warehouseId: string }>();
  const [items, setItems] = useState<ItemWithBox[]>([]);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [shoppingList, setShoppingList] = useState<ShoppingListItem[]>([]);
  const [goalDays, setGoalDays] = useState(14);
  const [warehouseName, setWarehouseName] = useState('Kalta');
  const [entries, setEntries] = useState<ChecklistEntry[]>([]);
  const [overrides, setOverrides] = useState<Map<string, KitOverride>>(new Map());
  const [pins, setPins] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showNotRelevant, setShowNotRelevant] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [matching, setMatching] = useState(false);
  const [aiProposal, setAiProposal] = useState<AiProposal | null>(null);
  const [aiProposalOpen, setAiProposalOpen] = useState(false);

  const load = useCallback(async () => {
    if (!warehouseId) return;
    hasAnthropicKey().then(setAiEnabled).catch(() => {});
    try {
      const [rows, mem, wh, shop, checklists, links, sats] = await Promise.all([
        listAllItemsInWarehouse(warehouseId),
        listHouseholdMembers(warehouseId),
        getWarehouseById(warehouseId),
        listShoppingList(warehouseId).catch(() => [] as ShoppingListItem[]),
        ensureSeededChecklists(warehouseId),
        listWarehouseChecklists(warehouseId).catch(() => []),
        listChecklistSatisfactions(warehouseId).catch(() => []),
      ]);
      setItems(rows);
      setMembers(mem);
      setShoppingList(shop);
      setGoalDays(wh?.readiness_goal_days ?? 14);
      setWarehouseName(wh?.name ?? 'Kalta');

      // Active checklists = those linked to the warehouse; fall back to all
      // (a warehouse with checklists but no explicit links still shows them).
      const linkedIds = new Set(links.map((l) => l.checklist_id));
      const activeIds = checklists
        .filter((c) => linkedIds.size === 0 || linkedIds.has(c.id))
        .map((c) => c.id);
      const entryLists = await Promise.all(activeIds.map((id) => listChecklistEntries(id)));
      const allEntries = entryLists.flat();
      setEntries(allEntries);

      const entryIds = new Set(allEntries.map((e) => e.id));
      const { overrides: ov, pins: pn } = satisfactionsToMaps(
        sats.filter((s) => entryIds.has(s.checklist_entry_id)),
      );
      setOverrides(ov);
      setPins(pn);
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

  // Live-update when a peer edits a checklist / satisfaction / household member
  // on another device.
  useEffect(() => {
    if (!warehouseId) return;
    const unsubKit = subscribeChecklists(warehouseId, () => load());
    const unsubHh = subscribeHousehold(warehouseId, () => load());
    return () => {
      unsubKit();
      unsubHh();
    };
  }, [warehouseId, load]);

  const kitItems = useMemo(() => entries.map(entryToKitItem), [entries]);
  const useSoonCount = useMemo(
    () =>
      items.filter((i) => {
        const s = getExpiryStatus(i.expiry_date);
        return s === 'expired' || s === 'critical' || s === 'soon';
      }).length,
    [items],
  );

  // Preliminary pass (no readiness) just to detect the water filter, which
  // feeds computeReadiness. The final kit pass below uses the readiness result
  // so quantified entries (food/water) become coverage-by-days.
  const kitForFilter = useMemo(
    () => computeKitCoverage(items, overrides, shoppingList, { entries: kitItems, pins }),
    [items, overrides, shoppingList, kitItems, pins],
  );
  const hasWaterFilter = useMemo(() => {
    const wfEntry = entries.find((e) => e.seed_key === 'water-filter');
    if (!wfEntry) return false;
    return kitForFilter.entries.some((e) => e.item.id === wfEntry.id && e.covered);
  }, [entries, kitForFilter]);
  const result = useMemo(
    () => computeReadiness(items, members, { hasWaterFilter }),
    [items, members, hasWaterFilter],
  );
  const kit = useMemo(
    () =>
      computeKitCoverage(items, overrides, shoppingList, {
        entries: kitItems,
        pins,
        readiness: result,
        goalDays,
      }),
    [items, overrides, shoppingList, kitItems, pins, result, goalDays],
  );

  // Push the latest readiness summary to the home-screen widget (iOS, no-op
  // otherwise) so it reflects the warehouse the user last opened.
  useEffect(() => {
    const wl = result.weakestLink;
    const ratio = wl && goalDays > 0 ? wl.days / goalDays : 0;
    updateReadinessWidget({
      days: wl?.days ?? 0,
      tone: wl == null ? 'none' : ratio >= 1 ? 'green' : ratio >= 0.25 ? 'amber' : 'red',
      expiringCount: useSoonCount,
      warehouseName,
    });
  }, [result, goalDays, useSoonCount, warehouseName]);

  // Persist a satisfaction override to the DB (synced). Pass null to clear.
  const setOverride = (entryId: string, value: KitOverride | null) => {
    if (!warehouseId) return;
    setChecklistSatisfaction({
      checklist_entry_id: entryId,
      warehouse_id: warehouseId,
      mode: value,
    })
      .then(() => load())
      .catch((e: any) => toast.error(e?.message ?? 'Could not update.'));
  };

  // Pin a specific inventory item to a kit entry (entryId === kit item id) so
  // it counts as covering that entry even when keywords don't auto-match.
  const [pinTarget, setPinTarget] = useState<{ id: string; label: string } | null>(null);
  const [pinQuery, setPinQuery] = useState('');

  const pinToItem = (kitItem: { id: string; label: string }) => {
    if (items.filter((i) => getExpiryStatus(i.expiry_date) !== 'expired').length === 0) {
      toast.info('There are no inventory items to pin.');
      return;
    }
    setPinQuery('');
    setPinTarget(kitItem);
  };

  const setPin = (entryId: string, itemId: string) => {
    if (!warehouseId) return;
    setPinTarget(null);
    setChecklistSatisfaction({
      checklist_entry_id: entryId,
      warehouse_id: warehouseId,
      mode: 'pin',
      item_id: itemId,
    })
      .then(() => load())
      .catch((e: any) => toast.error(e?.message ?? 'Could not pin.'));
  };

  const pinResults = useMemo(() => {
    const usable = items.filter((i) => getExpiryStatus(i.expiry_date) !== 'expired');
    const q = pinQuery.trim().toLowerCase();
    const list = q
      ? usable.filter(
          (i) =>
            i.name.toLowerCase().includes(q) || (i.box_name ?? '').toLowerCase().includes(q),
        )
      : usable;
    return list.slice(0, 100);
  }, [items, pinQuery]);

  const applyAiProposal = async (edited: AiProposal) => {
    if (!warehouseId) return;
    if (edited.kind === 'pins') {
      for (const m of edited.matches) {
        await setChecklistSatisfaction({
          checklist_entry_id: m.entryId,
          warehouse_id: warehouseId,
          mode: 'pin',
          item_id: m.itemId,
        }).catch(() => {});
      }
    } else if (edited.kind === 'shopping') {
      for (const r of edited.rows) {
        await addShoppingItem({
          warehouse_id: warehouseId,
          label: r.label,
          category: r.category,
          source: 'ai',
          quantity: r.quantity,
          reason: r.reason,
        }).catch(() => {});
      }
    }
    load();
  };

  const runAdvisor = () => {
    if (result.weakestLink == null) {
      toast.info('Add household members first so the advisor knows who to plan for.');
      return;
    }
    showAlert(
      'AI advisor',
      'Send your readiness summary (household, days of supply, missing kit) to Anthropic for a prioritized shopping list? This uses your API key.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Analyze',
          onPress: async () => {
            setMatching(true);
            try {
              const counts = new Map<string, number>();
              for (const m of members) {
                const k = m.kind ?? 'person';
                counts.set(k, (counts.get(k) ?? 0) + 1);
              }
              const household =
                [...counts].map(([k, n]) => `${n}× ${k}`).join(', ') || `${members.length} people`;
              const missingKit = kit.entries
                .filter((e) => e.applicable && e.state === 'missing')
                .map((e) => e.item.label);
              const proposal = await analyzeReadiness({
                household,
                goalDays,
                foodDays: result.foodDays,
                waterDays: result.waterDays,
                uncounted: result.uncountedItems,
                missingKit,
              });
              if (proposal.kind !== 'shopping' || proposal.rows.length === 0) {
                toast.info('The advisor returned nothing to add.');
                return;
              }
              setAiProposal(proposal);
              setAiProposalOpen(true);
            } catch (e: any) {
              toast.error(e?.message ?? 'Could not reach Claude.');
            } finally {
              setMatching(false);
            }
          },
        },
      ],
    );
  };

  const runSmartMatch = () => {
    // Only the entries the local matcher couldn't cover and the user hasn't
    // already decided on — that's where AI adds value.
    const targets = kit.entries.filter(
      (e) => e.applicable && e.override == null && e.state !== 'stocked',
    );
    const usableItems = items
      .filter((i) => getExpiryStatus(i.expiry_date) !== 'expired')
      .map((i) => ({ id: i.id, name: i.name }));

    if (targets.length === 0) {
      toast.info('Every checklist item is already covered or decided.');
      return;
    }
    if (usableItems.length === 0) {
      toast.info('There are no inventory items to match against.');
      return;
    }

    // Explicit opt-in before any network call (BYOK — uses the user's key).
    showAlert(
      'Smart match',
      `Send ${usableItems.length} item ${usableItems.length === 1 ? 'name' : 'names'} to Anthropic to suggest matches for ${targets.length} checklist ${targets.length === 1 ? 'item' : 'items'}? This uses your API key.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Match',
          onPress: async () => {
            setMatching(true);
            try {
              const proposal = await suggestKitMatches(
                targets.map((e) => ({
                  id: e.item.id,
                  label: e.item.label,
                  rationale: e.item.rationale,
                })),
                usableItems,
              );
              if (proposal.kind !== 'pins' || proposal.matches.length === 0) {
                toast.info('Claude found no confident matches.');
                return;
              }
              setAiProposal(proposal);
              setAiProposalOpen(true);
            } catch (e: any) {
              toast.error(e?.message ?? 'Could not reach Claude.');
            } finally {
              setMatching(false);
            }
          },
        },
      ],
    );
  };

  const goToShopping = () => router.push(`/warehouse/${warehouseId}/shopping` as any);

  const addGapToShopping = (item: KitCoverageEntry['item']) => {
    addShoppingItem({
      warehouse_id: warehouseId!,
      label: item.label,
      category: item.category,
      source: 'gap',
      source_ref: item.id,
    })
      .then(() => load())
      .catch((e: any) => toast.error(e?.message ?? 'Cannot add to shopping list.'));
  };

  const handleEntryPress = (entry: KitCoverageEntry) => {
    const { item, state, override, matchedItem } = entry;

    // User previously marked this irrelevant for the warehouse.
    if (override === 'not_applicable') {
      showAlert(item.label, 'Marked as not relevant for this warehouse.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Make it relevant again', onPress: () => setOverride(item.id, null) },
      ]);
      return;
    }

    // User previously forced this to stocked despite no real match.
    if (override === 'force_stocked') {
      showAlert(item.label, 'You marked this as covered.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Not relevant here', onPress: () => setOverride(item.id, 'not_applicable') },
        { text: 'Reset to auto-detect', onPress: () => setOverride(item.id, null) },
      ]);
      return;
    }

    // User previously forced to missing despite the matcher finding something.
    if (override === 'force_missing') {
      showAlert(
        item.label,
        matchedItem
          ? `You marked this as missing despite "${matchedItem.name}" being in inventory.`
          : 'You marked this as missing.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Reset to auto-detect', onPress: () => setOverride(item.id, null) },
        ],
      );
      return;
    }

    // Opts-array action sheet so adding "Pin to an item…" doesn't require
    // re-juggling positional indices.
    const runSheet = (
      title: string,
      message: string | undefined,
      opts: { label: string; run: () => void; destructive?: boolean }[],
    ) => {
      const labels = opts.map((o) => o.label);
      showActionSheet(
        {
          title,
          message: message || undefined,
          options: [...labels, 'Cancel'],
          cancelButtonIndex: labels.length,
          destructiveButtonIndex: opts.findIndex((o) => o.destructive),
        },
        (idx) => {
          if (idx != null && idx < opts.length) opts[idx].run();
        },
      );
    };
    const pinOpt = { label: 'Pin to an item…', run: () => pinToItem(item) };

    if (state === 'stocked' || state === 'partial') {
      // Real inventory match (or quantified supply) — let the user back out of
      // false positives or hide the entry without changing inventory.
      const message =
        state === 'partial'
          ? `${entry.days != null ? formatDays(entry.days) : 'Some'} of supply — below your goal.`
          : matchedItem
            ? `Matched: "${matchedItem.name}"`
            : 'Covered.';
      runSheet(item.label, message, [
        pinOpt,
        ...(pins.has(item.id)
          ? [{ label: 'Unpin (reset to auto-detect)', run: () => setOverride(item.id, null) }]
          : []),
        { label: `That's not really ${item.label}`, run: () => setOverride(item.id, 'force_missing'), destructive: true },
        { label: 'Not relevant here', run: () => setOverride(item.id, 'not_applicable') },
      ]);
      return;
    }

    if (state === 'on_list' || state === 'purchased') {
      const message =
        state === 'purchased'
          ? 'You marked this as purchased. Open Shopping list to restock.'
          : 'This is on your shopping list.';
      runSheet(item.label, message, [
        { label: 'Open shopping list', run: goToShopping },
        pinOpt,
        { label: 'I already have this', run: () => setOverride(item.id, 'force_stocked') },
        { label: 'Not relevant here', run: () => setOverride(item.id, 'not_applicable') },
      ]);
      return;
    }

    // missing
    runSheet(item.label, item.rationale ?? undefined, [
      { label: 'Add to shopping list', run: () => addGapToShopping(item) },
      pinOpt,
      { label: 'I already have this', run: () => setOverride(item.id, 'force_stocked') },
      { label: 'Not relevant here', run: () => setOverride(item.id, 'not_applicable') },
    ]);
  };

  const goToSettings = () => router.push(`/warehouse/${warehouseId}/settings` as any);

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
        <Text style={styles.topBarTitle}>Readiness</Text>
        <View style={styles.topBarBtn} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {result.weakestLink == null ? (
            <View style={styles.emptyCard}>
              <Icon sf="person.2.fill" size={40} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>No household yet</Text>
              <Text style={styles.emptyText}>
                Add household members to see how many days your supplies will last.
              </Text>
              <Pressable style={styles.primaryBtn} onPress={goToSettings}>
                <Text style={styles.primaryBtnText}>Set up household</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Headline result={result} goalDays={goalDays} />

              <Text style={styles.sectionLabel}>COVERAGE</Text>
              <CoverageBar
                label="Food"
                sf="fork.knife"
                days={result.foodDays}
                goalDays={goalDays}
                detail={`${Math.round(result.perCategory.food.totalKcal ?? 0).toLocaleString()} kcal stored`}
              />
              <CoverageBar
                label="Water"
                sf="drop.fill"
                days={result.waterDays}
                goalDays={goalDays}
                detail={
                  hasWaterFilter
                    ? `${(result.perCategory.water.totalL ?? 0).toFixed(1)} L stored + water filter extends supply`
                    : `${(result.perCategory.water.totalL ?? 0).toFixed(1)} L stored`
                }
                filtered={hasWaterFilter}
              />

              {result.uncountedItems > 0 && (
                <View style={styles.noteRow}>
                  <Icon sf="info.circle" size={15} color={colors.textMuted} />
                  <Text style={styles.noteText}>
                    {result.uncountedItems}{' '}
                    {result.uncountedItems === 1 ? 'item is' : 'items are'} not counted —
                    add calories / weight so they count toward readiness.
                  </Text>
                </View>
              )}
            </>
          )}

          {/* Emergency kit completeness */}
          <View style={styles.kitHeaderRow}>
            <Text style={styles.sectionLabel}>EMERGENCY KIT</Text>
            <Text style={styles.kitCount}>
              {kit.coveredCount}/{kit.total}
            </Text>
          </View>
          <KitChecklist
            entries={kit.entries.filter((e) => e.applicable)}
            onPress={handleEntryPress}
          />

          {aiEnabled && (
            <Pressable
              style={({ pressed }) => [styles.smartMatchBtn, pressed && { opacity: 0.7 }]}
              onPress={runSmartMatch}
              disabled={matching}
            >
              {matching ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <Icon sf="sparkles" size={15} color={colors.primary} />
              )}
              <Text style={styles.smartMatchText}>
                {matching ? 'Matching…' : 'Smart match with AI'}
              </Text>
            </Pressable>
          )}

          {aiEnabled && (
            <Pressable
              style={({ pressed }) => [styles.smartMatchBtn, pressed && { opacity: 0.7 }]}
              onPress={runAdvisor}
              disabled={matching}
            >
              <Icon sf="wand.and.stars" size={15} color={colors.primary} />
              <Text style={styles.smartMatchText}>AI advisor — what should I buy?</Text>
            </Pressable>
          )}

          {/* Not relevant — collapsed by default, excluded from the count */}
          {kit.entries.some((e) => !e.applicable) && (
            <View style={styles.notRelevantWrap}>
              <Pressable
                style={({ pressed }) => [styles.notRelevantHeader, pressed && { opacity: 0.6 }]}
                onPress={() => setShowNotRelevant((v) => !v)}
              >
                <Icon
                  sf={showNotRelevant ? 'chevron.down' : 'chevron.right'}
                  size={12}
                  color={colors.textMuted}
                />
                <Text style={styles.notRelevantLabel}>
                  Not relevant ({kit.entries.filter((e) => !e.applicable).length})
                </Text>
              </Pressable>
              {showNotRelevant && (
                <View style={styles.kitRowWrap}>
                  {kit.entries
                    .filter((e) => !e.applicable)
                    .map((e) => (
                      <Pressable
                        key={e.item.id}
                        onPress={() => handleEntryPress(e)}
                        style={({ pressed }) => [
                          styles.kitChip,
                          styles.notRelevantChip,
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        <Icon sf="minus.circle" size={14} color={colors.textSubtle} />
                        <Text style={[styles.kitChipText, { color: colors.textSubtle }]}>
                          {e.item.label}
                        </Text>
                      </Pressable>
                    ))}
                </View>
              )}
            </View>
          )}

          {/* Custom checklists link */}
          <Pressable
            style={({ pressed }) => [styles.needsCard, { marginTop: spacing.md }, pressed && { opacity: 0.7 }]}
            onPress={() => router.push(`/warehouse/${warehouseId}/checklists` as any)}
          >
            <Icon sf="checklist" size={20} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.needsTitle}>Checklists</Text>
              <Text style={styles.needsSub}>Custom lists of what to keep ready</Text>
            </View>
            <Icon sf="chevron.right" size={14} color={colors.textSubtle} />
          </Pressable>

          {/* Use soon link */}
          <Pressable
            style={({ pressed }) => [styles.needsCard, { marginTop: spacing.sm }, pressed && { opacity: 0.7 }]}
            onPress={() => router.push(`/warehouse/${warehouseId}/use-soon` as any)}
          >
            <Icon sf="clock.badge.exclamationmark" size={20} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.needsTitle}>Use soon</Text>
              <Text style={styles.needsSub}>
                {useSoonCount > 0
                  ? `${useSoonCount} ${useSoonCount === 1 ? 'item' : 'items'} expiring — rotate them first`
                  : 'Nothing expiring in 90 days'}
              </Text>
            </View>
            <Icon sf="chevron.right" size={14} color={colors.textSubtle} />
          </Pressable>

          {/* Shopping list link */}
          <Pressable
            style={({ pressed }) => [styles.needsCard, { marginTop: spacing.sm }, pressed && { opacity: 0.7 }]}
            onPress={() => router.push(`/warehouse/${warehouseId}/shopping` as any)}
          >
            <Icon sf="cart.fill" size={20} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.needsTitle}>Shopping list</Text>
              <Text style={styles.needsSub}>Buy what's expired, low, or missing</Text>
            </View>
            <Icon sf="chevron.right" size={14} color={colors.textSubtle} />
          </Pressable>

          {/* Household needs */}
          <Text style={styles.sectionLabel}>DAILY NEEDS</Text>
          <Pressable
            style={({ pressed }) => [styles.needsCard, pressed && { opacity: 0.7 }]}
            onPress={goToSettings}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.needsTitle}>
                {members.length} {members.length === 1 ? 'person' : 'people'}
              </Text>
              <Text style={styles.needsSub}>
                {result
                  ? `${result.totalDailyKcal.toLocaleString()} kcal · ${result.totalDailyWaterL.toFixed(1)} L per day`
                  : '—'}
              </Text>
            </View>
            <Text style={styles.manageLink}>Manage</Text>
            <Icon sf="chevron.right" size={14} color={colors.textSubtle} />
          </Pressable>

          <Text style={styles.goalLine}>Goal: {goalLabel(goalDays)} of supply</Text>
        </ScrollView>
      )}

      <AiProposalSheet
        visible={aiProposalOpen}
        proposal={aiProposal}
        title={aiProposal?.kind === 'shopping' ? 'AI advisor' : 'Smart match'}
        onConfirm={applyAiProposal}
        onClose={() => setAiProposalOpen(false)}
      />

      {/* Pin picker — connect a specific inventory item to a kit entry */}
      <Modal
        visible={pinTarget != null}
        presentationStyle="pageSheet"
        animationType="slide"
        onRequestClose={() => setPinTarget(null)}
      >
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.pinHeader}>
            <Pressable hitSlop={12} onPress={() => setPinTarget(null)}>
              <Text style={styles.pinHeaderBtn}>Cancel</Text>
            </Pressable>
            <Text style={styles.pinHeaderTitle} numberOfLines={1}>
              Covers “{pinTarget?.label}”
            </Text>
            <View style={{ width: 52 }} />
          </View>
          <TextInput
            style={styles.pinSearch}
            value={pinQuery}
            onChangeText={setPinQuery}
            placeholder="Search items by name or box…"
            placeholderTextColor={colors.textSubtle}
            autoCorrect={false}
          />
          <FlatList
            data={pinResults}
            keyExtractor={(i) => i.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: spacing.md }}
            ListEmptyComponent={<Text style={styles.pinEmpty}>No matching items.</Text>}
            renderItem={({ item: inv }) => (
              <Pressable
                style={({ pressed }) => [styles.pinRow, pressed && { opacity: 0.6 }]}
                onPress={() => pinTarget && setPin(pinTarget.id, inv.id)}
              >
                <Text style={styles.pinRowName} numberOfLines={1}>
                  {inv.name}
                </Text>
                {!!inv.box_name && <Text style={styles.pinRowBox}>{inv.box_name}</Text>}
              </Pressable>
            )}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
function Headline({ result, goalDays }: { result: ReadinessResult; goalDays: number }) {
  const wl = result.weakestLink!;
  const ratio = goalDays > 0 ? wl.days / goalDays : 0;
  const tone = toneFor(ratio);
  const color = TONE_COLOR[tone];
  return (
    <View style={[styles.headlineCard, { borderColor: color }]}>
      <Icon
        sf={tone === 'green' ? 'shield.lefthalf.filled' : 'exclamationmark.triangle.fill'}
        size={28}
        color={color}
      />
      <Text style={[styles.headlineDays, { color }]}>{formatDays(wl.days)}</Text>
      <Text style={styles.headlineSub}>
        {tone === 'green'
          ? 'You are ready'
          : `${wl.category === 'water' ? 'Water' : 'Food'} is your weak point`}
      </Text>
    </View>
  );
}

function CoverageBar({
  label,
  sf,
  days,
  goalDays,
  detail,
  filtered = false,
}: {
  label: string;
  sf: Parameters<typeof Icon>[0]['sf'];
  days: number | null;
  goalDays: number;
  detail: string;
  /** Treat as covered regardless of days (e.g. water filter present). */
  filtered?: boolean;
}) {
  const ratio = days != null && goalDays > 0 ? days / goalDays : 0;
  const tone: Tone = filtered ? 'green' : toneFor(ratio);
  const color = TONE_COLOR[tone];
  const fillPct = filtered ? 100 : Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <View style={styles.coverageRow}>
      <View style={styles.coverageHeader}>
        <Icon sf={sf} size={16} color={colors.textMuted} />
        <Text style={styles.coverageLabel}>{label}</Text>
        {filtered && (
          <View style={styles.filterBadge}>
            <Icon sf="checkmark.circle.fill" size={11} color={colors.successText} />
            <Text style={styles.filterBadgeText}>Filter</Text>
          </View>
        )}
        <Text style={[styles.coverageDays, { color: days != null ? color : colors.textSubtle }]}>
          {days != null ? formatDays(days) : '—'}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${fillPct}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.coverageDetail}>{detail}</Text>
    </View>
  );
}

// Map each kit lifecycle state to the chip visual. Stocked = green, purchased
// = amber bag, on_list = blue cart, missing = red plus.
function chipVisualFor(entry: KitCoverageEntry): {
  bg: string;
  border: string;
  fg: string;
  icon: Parameters<typeof Icon>[0]['sf'];
} {
  if (entry.state === 'stocked') {
    return {
      bg: colors.successBg,
      border: colors.successBgStrong,
      fg: colors.successText,
      icon: 'checkmark.circle.fill',
    };
  }
  if (entry.state === 'purchased') {
    return {
      bg: colors.warningBg,
      border: colors.warningBgStrong,
      fg: colors.warningText,
      icon: 'bag.fill',
    };
  }
  if (entry.state === 'on_list') {
    return {
      bg: colors.primaryTint,
      border: colors.primarySubtle,
      fg: colors.primary,
      icon: 'cart.fill',
    };
  }
  if (entry.state === 'partial') {
    // Quantified entry with some supply but below goal — amber, half-filled.
    return {
      bg: colors.warningBg,
      border: colors.warningBgStrong,
      fg: colors.warningText,
      icon: 'circle.lefthalf.filled',
    };
  }
  // missing
  return {
    bg: colors.dangerBg,
    border: colors.dangerBgStrong,
    fg: colors.dangerText,
    icon: 'plus.circle',
  };
}

function KitChecklist({
  entries,
  onPress,
}: {
  entries: KitCoverageEntry[];
  onPress: (entry: KitCoverageEntry) => void;
}) {
  // Group preserving the checklist's declared order.
  const groups: { name: string; entries: KitCoverageEntry[] }[] = [];
  for (const e of entries) {
    let g = groups.find((x) => x.name === e.item.group);
    if (!g) {
      g = { name: e.item.group, entries: [] };
      groups.push(g);
    }
    g.entries.push(e);
  }

  return (
    <View style={styles.kitCard}>
      {groups.map((g) => {
        // All items in a kit group share the same domain category, so the
        // first one is enough to pick the section glyph.
        const cat = g.entries[0]?.item.category ?? null;
        return (
        <View key={g.name} style={styles.kitGroup}>
          <View style={styles.kitGroupHeader}>
            {cat && (
              <Icon sf={CATEGORY_SF[cat]} size={13} color={colors.textMuted} />
            )}
            <Text style={styles.kitGroupLabel}>{g.name}</Text>
          </View>
          <View style={styles.kitRowWrap}>
            {g.entries.map((e) => {
              const v = chipVisualFor(e);
              return (
                <Pressable
                  key={e.item.id}
                  onPress={() => onPress(e)}
                  style={({ pressed }) => [
                    styles.kitChip,
                    { backgroundColor: v.bg, borderColor: v.border },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Icon sf={v.icon} size={14} color={v.fg} />
                  <Text
                    style={[
                      styles.kitChipText,
                      { color: v.fg },
                      // Strike-through any user override so it's clear at a
                      // glance that the chip's state isn't the matcher's
                      // verdict — applies to both force_stocked (dismissed
                      // gap) and force_missing (rejected match).
                      e.override != null && styles.kitChipDismissed,
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
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  pinHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pinHeaderBtn: { ...typography.body, color: colors.primary, width: 52 },
  pinHeaderTitle: { ...typography.headline, color: colors.text, flex: 1, textAlign: 'center' },
  pinSearch: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    margin: spacing.md,
    marginBottom: 0,
  },
  pinEmpty: { ...typography.footnote, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl },
  pinRow: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.xs,
  },
  pinRowName: { ...typography.body, color: colors.text, fontWeight: '600' },
  pinRowBox: { ...typography.footnote, color: colors.textMuted, marginTop: 2 },
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
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xs },

  headlineCard: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    ...shadows.sm,
  },
  headlineDays: { ...typography.title1, fontWeight: '800' },
  headlineSub: { ...typography.subhead, color: colors.textMuted },

  sectionLabel: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },

  coverageRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md + 2,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  coverageHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  coverageLabel: { ...typography.body, color: colors.text, fontWeight: '600', flex: 1 },
  coverageDays: { ...typography.body, fontWeight: '800' },
  filterBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.successBg,
    borderWidth: 1,
    borderColor: colors.successBgStrong,
  },
  filterBadgeText: {
    ...typography.caption,
    color: colors.successText,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.palette.neutral[100],
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 4 },
  coverageDetail: { ...typography.footnote, color: colors.textMuted },

  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  noteText: { ...typography.footnote, color: colors.textMuted, flex: 1, lineHeight: 18 },

  needsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md + 2,
  },
  needsTitle: { ...typography.body, color: colors.text, fontWeight: '700' },
  needsSub: { ...typography.footnote, color: colors.textMuted, marginTop: 2 },
  manageLink: { ...typography.footnote, color: colors.primary, fontWeight: '700' },

  goalLine: {
    ...typography.footnote,
    color: colors.textSubtle,
    textAlign: 'center',
    marginTop: spacing.lg,
  },

  kitHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  kitCount: { ...typography.subhead, color: colors.text, fontWeight: '800' },
  kitCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md + 2,
    gap: spacing.md,
  },
  kitGroup: { gap: spacing.xs + 2 },
  kitGroupHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kitGroupLabel: { ...typography.label, color: colors.textMuted },
  kitRowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2 },
  kitChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  kitChipCovered: { backgroundColor: colors.successBg, borderColor: colors.successBgStrong },
  kitChipGap: { backgroundColor: colors.dangerBg, borderColor: colors.dangerBgStrong },
  kitChipText: { ...typography.footnote, fontWeight: '600' },
  kitChipDismissed: { textDecorationLine: 'line-through', opacity: 0.7 },

  notRelevantWrap: { marginTop: spacing.sm, gap: spacing.xs + 2 },
  notRelevantHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.xs,
  },
  notRelevantLabel: { ...typography.label, color: colors.textMuted },
  notRelevantChip: { backgroundColor: colors.palette.neutral[100], borderColor: colors.border },

  smartMatchBtn: {
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
  smartMatchText: { ...typography.subhead, color: colors.primary, fontWeight: '700' },

  emptyCard: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  emptyTitle: { ...typography.title3, color: colors.text, marginTop: spacing.sm },
  emptyText: { ...typography.subhead, color: colors.textMuted, textAlign: 'center' },
  primaryBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
  },
  primaryBtnText: { ...typography.bodyStrong, color: colors.textOnPrimary },
});
