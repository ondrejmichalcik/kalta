// ============================================================================
// Kalta – Readiness detail screen (Sprint 6)
// Weakest-link headline + per-category coverage bars (food / water) measured
// against the warehouse readiness goal. Surfaces uncounted items and the
// household needs that drive the math. Goal + members are managed in
// warehouse settings (HOUSEHOLD section).
// ============================================================================
import { useCallback, useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  addShoppingItem,
  getWarehouseById,
  listAllItemsInWarehouse,
  listHouseholdMembers,
  listShoppingList,
} from '@/src/lib/supabase';
import { computeReadiness, type ReadinessResult } from '@/src/lib/readiness';
import { computeKitCoverage, type KitCoverageEntry } from '@/src/lib/kitCoverage';
import type { HouseholdMember, ItemWithBox, ShoppingListItem } from '@/src/types/database';
import { colors, radius, shadows, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';
import { CATEGORY_SF } from '@/src/components/categoryIcons';

const dismissKey = (warehouseId: string) => `@kalta/kit_dismissed_${warehouseId}`;

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
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!warehouseId) return;
    try {
      const [rows, mem, wh, shop, dismissedRaw] = await Promise.all([
        listAllItemsInWarehouse(warehouseId),
        listHouseholdMembers(warehouseId),
        getWarehouseById(warehouseId),
        listShoppingList(warehouseId).catch(() => [] as ShoppingListItem[]),
        AsyncStorage.getItem(dismissKey(warehouseId)).catch(() => null),
      ]);
      setItems(rows);
      setMembers(mem);
      setShoppingList(shop);
      setGoalDays(wh?.readiness_goal_days ?? 14);
      if (dismissedRaw) {
        try {
          setDismissed(new Set(JSON.parse(dismissedRaw) as string[]));
        } catch {
          /* corrupt — ignore */
        }
      }
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

  const kit = useMemo(
    () => computeKitCoverage(items, dismissed, shoppingList),
    [items, dismissed, shoppingList],
  );
  const hasWaterFilter = useMemo(
    () => kit.entries.some((e) => e.item.id === 'water-filter' && e.covered),
    [kit],
  );
  const result = useMemo(
    () => computeReadiness(items, members, { hasWaterFilter }),
    [items, members, hasWaterFilter],
  );

  const persistDismissed = (next: Set<string>) => {
    setDismissed(next);
    if (warehouseId) {
      AsyncStorage.setItem(dismissKey(warehouseId), JSON.stringify([...next])).catch(() => {});
    }
  };

  const toggleDismiss = (id: string) => {
    const next = new Set(dismissed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    persistDismissed(next);
  };

  const goToShopping = () => router.push(`/warehouse/${warehouseId}/shopping` as any);

  const handleEntryPress = (entry: KitCoverageEntry) => {
    const { item, state, dismissed: isDismissed } = entry;
    if (isDismissed) {
      Alert.alert(item.label, 'You marked this as covered.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Mark as missing again', onPress: () => toggleDismiss(item.id) },
      ]);
      return;
    }
    if (state === 'stocked') return; // genuinely in stock — nothing to do
    if (state === 'on_list' || state === 'purchased') {
      // Already tracked — bounce the user to the shopping list to finish the loop.
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: item.label,
          message:
            state === 'purchased'
              ? 'You marked this as purchased. Open Shopping list to restock.'
              : 'This is on your shopping list.',
          options: ['Open shopping list', 'I already have this', 'Cancel'],
          cancelButtonIndex: 2,
        },
        (idx) => {
          if (idx === 0) goToShopping();
          else if (idx === 1) toggleDismiss(item.id);
        },
      );
      return;
    }
    // missing
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: item.label,
        message: item.rationale,
        options: ['Add to shopping list', 'I already have this', 'Cancel'],
        cancelButtonIndex: 2,
      },
      (idx) => {
        if (idx === 0) {
          addShoppingItem({
            warehouse_id: warehouseId!,
            label: item.label,
            category: item.category,
            source: 'gap',
            source_ref: item.id,
          })
            .then(() => {
              load(); // refresh so the chip flips to on_list immediately
            })
            .catch((e: any) => Alert.alert('Error', e?.message ?? 'Cannot add to shopping list.'));
        } else if (idx === 1) {
          toggleDismiss(item.id);
        }
      },
    );
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
          <KitChecklist entries={kit.entries} onPress={handleEntryPress} />

          {/* Shopping list link */}
          <Pressable
            style={({ pressed }) => [styles.needsCard, { marginTop: spacing.md }, pressed && { opacity: 0.7 }]}
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
                      e.dismissed && styles.kitChipDismissed,
                    ]}
                  >
                    {e.item.label}
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
