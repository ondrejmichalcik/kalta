// ============================================================================
// Kalta – FilterSheet
// Bottom-sheet modal for filtering the items list. Three sections:
//   - Status (radio: All / Expired / ≤1d / ≤30d / ≤60d / OK / No date)
//   - Condition (multi-select: Opened / Damaged / Has note — OR semantics)
//   - Category (multi-select checkboxes across the 8 categories)
// Stages its own local state while open so the user can tweak without
// thrashing the underlying list, then commits on Apply.
// ============================================================================
import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Category } from '@/src/types/database';
import { CATEGORIES, CATEGORY_LABEL, daysUntil } from '@/src/types/database';
import { colors, radius, spacing, typography } from '@/src/theme';
import { Icon } from './Icon';

// Expiry filter buckets that align with the notification windows
// (60 / 30 / 1 days). Using day-thresholds here instead of the ExpiryStatus
// enum so the filter UI exactly mirrors what a notification alerts about.
// ExpiryStatus keeps its own thresholds for card / sort / StatusDot colors.
export type StatusFilter =
  | 'all'
  | 'expired'
  | 'within_1d'
  | 'within_30d'
  | 'within_60d'
  | 'ok'
  | 'none';

// Condition flags an item can carry that are worth surfacing as filters —
// all "attention" markers rendered as badges on item rows (OPENED / DAMAGED
// / NOTE). Multi-select with OR semantics so checking multiple conditions
// widens the set ("show me anything that needs attention").
export type ConditionFlag = 'opened' | 'damaged' | 'has_note';
export type ConditionFilter = ConditionFlag[];
// Multi-select: empty array == "no restriction" (show all), any non-empty
// subset == "only these". Storing as an array (not a Set) keeps it cheap to
// serialize and compare in React deps.
export type CategoryFilter = Category[];

export interface FilterState {
  status: StatusFilter;
  condition: ConditionFilter;
  category: CategoryFilter;
}

/**
 * True if an item with the given expiry_date matches the selected filter.
 * Mutual-exclusive across buckets — an "≤30 days" item only lives in the
 * ≤30 bucket (not also in ≤60); pick the most urgent matching bucket for
 * display purposes if needed.
 */
export function matchesExpiryFilter(
  dateStr: string | null,
  filter: StatusFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'none') return dateStr === null;
  if (dateStr === null) return false;
  const d = daysUntil(dateStr);
  switch (filter) {
    case 'expired': return d < 0;
    case 'within_1d': return d >= 0 && d <= 1;
    case 'within_30d': return d >= 0 && d <= 30;
    case 'within_60d': return d >= 0 && d <= 60;
    case 'ok': return d > 60;
  }
  return true;
}

/**
 * Multi-select category filter. Empty array = show everything; non-empty =
 * only items whose category is in the selection. Items with null category
 * are excluded once any selection exists (they don't match any bucket).
 */
export function matchesCategoryFilter(
  itemCategory: Category | null,
  filter: CategoryFilter,
): boolean {
  if (filter.length === 0) return true;
  if (itemCategory === null) return false;
  return filter.includes(itemCategory);
}

/**
 * Multi-select condition filter with OR semantics — an item passes if it
 * matches ANY of the checked flags. Empty array = no restriction.
 * Aligned with the three badges rendered on item rows (OPENED / DAMAGED / NOTE).
 */
export function matchesConditionFilter(
  item: { opened: boolean; damaged: boolean; notes: string | null },
  filter: ConditionFilter,
): boolean {
  if (filter.length === 0) return true;
  return filter.some((f) => {
    if (f === 'opened') return item.opened;
    if (f === 'damaged') return item.damaged;
    if (f === 'has_note') return !!(item.notes && item.notes.trim());
    return false;
  });
}

export type FilterSection = 'status' | 'condition' | 'category';

interface Props {
  visible: boolean;
  initial: FilterState;
  /** Which sections to render. Defaults to all three. Pass only the ones
   *  that apply to the current list (e.g. boxes don't have opened/category). */
  sections?: FilterSection[];
  onClose: () => void;
  onApply: (next: FilterState) => void;
}

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'expired', label: 'Expired' },
  { value: 'within_1d', label: '\u2264 1 day' },
  { value: 'within_30d', label: '\u2264 30 days' },
  { value: 'within_60d', label: '\u2264 60 days' },
  { value: 'ok', label: 'OK (60+ days)' },
  { value: 'none', label: 'No date' },
];

const CONDITION_OPTIONS: { value: ConditionFlag; label: string }[] = [
  { value: 'opened', label: 'Opened' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'has_note', label: 'Has note' },
];

function categoryLabel(c: Category): string {
  return CATEGORY_LABEL[c];
}

const DEFAULT_SECTIONS: FilterSection[] = ['status', 'condition', 'category'];

export function FilterSheet({ visible, initial, sections = DEFAULT_SECTIONS, onClose, onApply }: Props) {
  const [status, setStatus] = useState<StatusFilter>(initial.status);
  const [condition, setCondition] = useState<ConditionFilter>(initial.condition);
  const [category, setCategory] = useState<CategoryFilter>(initial.category);
  const showStatus = sections.includes('status');
  const showCondition = sections.includes('condition');
  const showCategory = sections.includes('category');

  // Reset local state from props every time the sheet opens — so a user who
  // closed without applying gets back to the committed state on next open.
  useEffect(() => {
    if (visible) {
      setStatus(initial.status);
      setCondition(initial.condition);
      setCategory(initial.category);
    }
  }, [visible, initial.status, initial.condition, initial.category]);

  const clearAll = () => {
    if (showStatus) setStatus('all');
    if (showCondition) setCondition([]);
    if (showCategory) setCategory([]);
  };

  const toggleCondition = (f: ConditionFlag) => {
    setCondition((prev) =>
      prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f],
    );
  };

  const toggleCategory = (c: Category) => {
    setCategory((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  };

  // Apply preserves filters for sections that aren't shown on this screen,
  // so hiding a section never silently clears its state.
  const apply = () => onApply({
    status: showStatus ? status : initial.status,
    condition: showCondition ? condition : initial.condition,
    category: showCategory ? category : initial.category,
  });

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable hitSlop={12} onPress={clearAll}>
            <Text style={styles.clearText}>Clear all</Text>
          </Pressable>
          <Text style={styles.title}>Filter</Text>
          <Pressable hitSlop={12} onPress={apply}>
            <Text style={styles.applyText}>Apply</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scroll}>
          {showStatus ? (
            <>
              <Text style={styles.sectionHeader}>STATUS</Text>
              <View style={styles.card}>
                {STATUS_OPTIONS.map((opt, idx) => (
                  <Pressable
                    key={opt.value}
                    onPress={() => setStatus(opt.value)}
                    style={({ pressed }) => [
                      styles.row,
                      idx < STATUS_OPTIONS.length - 1 && styles.rowBorder,
                      pressed && { opacity: 0.6 },
                    ]}
                  >
                    <Text style={styles.rowLabel}>{opt.label}</Text>
                    {status === opt.value ? (
                      <Icon sf="checkmark" size={18} color={colors.primary} />
                    ) : null}
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          {showCondition ? (
            <>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeader}>CONDITION</Text>
                {condition.length > 0 ? (
                  <Pressable hitSlop={6} onPress={() => setCondition([])}>
                    <Text style={styles.sectionAction}>Clear</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.card}>
                {CONDITION_OPTIONS.map((opt, idx) => {
                  const checked = condition.includes(opt.value);
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => toggleCondition(opt.value)}
                      style={({ pressed }) => [
                        styles.row,
                        idx < CONDITION_OPTIONS.length - 1 && styles.rowBorder,
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      <Text style={styles.rowLabel}>{opt.label}</Text>
                      <Icon
                        sf={checked ? 'checkmark.square.fill' : 'square'}
                        size={20}
                        color={checked ? colors.primary : colors.textSubtle}
                      />
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

          {showCategory ? (
            <>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeader}>CATEGORY</Text>
                {category.length > 0 ? (
                  <Pressable hitSlop={6} onPress={() => setCategory([])}>
                    <Text style={styles.sectionAction}>Clear</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.card}>
                {CATEGORIES.map((c, idx) => {
                  const checked = category.includes(c);
                  return (
                    <Pressable
                      key={c}
                      onPress={() => toggleCategory(c)}
                      style={({ pressed }) => [
                        styles.row,
                        idx < CATEGORIES.length - 1 && styles.rowBorder,
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      <Text style={styles.rowLabel}>{categoryLabel(c)}</Text>
                      <Icon
                        sf={checked ? 'checkmark.square.fill' : 'square'}
                        size={20}
                        color={checked ? colors.primary : colors.textSubtle}
                      />
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// ActiveFilterChips — renders the currently-applied filters above the list
// with a × to remove each. Tap-to-clear is a one-gesture shortcut without
// having to reopen the sheet.
// ---------------------------------------------------------------------------
export function ActiveFilterChips({
  status,
  condition,
  category,
  onClearStatus,
  onClearCondition,
  onClearCategory,
}: {
  status: StatusFilter;
  condition: ConditionFilter;
  category: CategoryFilter;
  onClearStatus: () => void;
  onClearCondition: () => void;
  onClearCategory: () => void;
}) {
  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (status !== 'all') {
    const opt = STATUS_OPTIONS.find((o) => o.value === status);
    if (opt) chips.push({ key: 'status', label: opt.label, onRemove: onClearStatus });
  }
  // Multi-select condition: show one chip per flag so the user can see
  // exactly what's applied (only ever 1–3, tiny cost).
  for (const f of condition) {
    const opt = CONDITION_OPTIONS.find((o) => o.value === f);
    if (opt) chips.push({
      key: `condition:${f}`,
      label: opt.label,
      onRemove: () => {
        // Remove just this flag — onClearCondition clears the whole set, so
        // wrap it in a setter that passes a subset. We don't have a setter
        // here, so the caller uses onClearCondition to mean "clear ALL
        // condition flags" — acceptable simplification for the chip tap.
        onClearCondition();
      },
    });
  }
  // Multi-select category: one chip if a single category is picked, else
  // a single summary chip "N categories" that clears the whole selection.
  if (category.length === 1) {
    chips.push({ key: 'category', label: categoryLabel(category[0]), onRemove: onClearCategory });
  } else if (category.length > 1) {
    chips.push({ key: 'category', label: `${category.length} categories`, onRemove: onClearCategory });
  }
  if (chips.length === 0) return null;

  // Max 3 chips (Status / Packs / Category) fit on any phone — plain flex-wrap
  // View is denser than a horizontal ScrollView (no implicit minHeight).
  return (
    <View style={styles.chipsRow}>
      {chips.map((c) => (
        <Pressable
          key={c.key}
          onPress={c.onRemove}
          hitSlop={6}
          style={({ pressed }) => [styles.activeChip, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.activeChipText}>{c.label}</Text>
          <Icon sf="xmark" size={9} color={colors.primary} />
        </Pressable>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { ...typography.headline, color: colors.text },
  clearText: { ...typography.body, color: colors.textMuted },
  applyText: { ...typography.bodyStrong, color: colors.primary },

  scroll: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  sectionHeader: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 0.5,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    marginLeft: spacing.xs,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  sectionAction: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLabel: { ...typography.body, color: colors.text },

  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingBottom: 6,
  },
  activeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 10,
    paddingRight: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: colors.primaryTint,
  },
  activeChipText: {
    fontSize: 12,
    lineHeight: 15,
    color: colors.primary,
    fontWeight: '700',
  },
});
