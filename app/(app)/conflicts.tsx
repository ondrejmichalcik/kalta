// ============================================================================
// Kalta – Sync conflict resolution screen
// Shows unresolved conflicts from bidirectional sync. User resolves
// per-field: pick local or server value for each conflicting field.
// Visual language matches the pending-changes screen (resource icon,
// git-diff style for the candidate values), with the diff rows being
// tappable to select which side wins.
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  getConflicts,
  resolveConflict,
  resolveConflictKeepLocal,
  resolveConflictTakeServer,
  type SyncConflict,
} from '@/src/lib/sync';
import { colors, radius, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';
import { ResourceIcon, type ResourceTable } from '@/src/components/ResourceIcon';
import type { Category } from '@/src/types/database';

const TABLE_LABEL: Record<string, string> = {
  warehouses: 'Warehouse',
  boxes: 'Box',
  items: 'Item',
  custom_products: 'Custom product',
  inventory_sessions: 'Inventory session',
  inventory_lines: 'Inventory line',
};

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  quantity: 'Quantity',
  unit: 'Unit',
  expiry_date: 'Expiry',
  barcode: 'Barcode',
  image_url: 'Photo',
  category: 'Category',
  notes: 'Notes',
  opened: 'Opened',
  damaged: 'Damaged',
  pack_count: 'Pack count',
  last_verified: 'Last verified',
  box_id: 'Box',
  location: 'Location',
  typical_expiry_days: 'Typical shelf life',
  completed_at: 'Completed',
  found_count: 'Found',
  missing_count: 'Missing',
};

function prettyField(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (field === 'image_url') return 'updated';
  if (field === 'expiry_date' || field === 'last_verified' || field === 'completed_at') {
    const ts = String(value);
    return ts.split('T')[0]?.split(' ')[0] ?? ts;
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
  }
  // Booleans coming through as 0/1 (SQLite boolean storage)
  if ((field === 'opened' || field === 'damaged') && (value === 0 || value === 1)) {
    return value === 1 ? 'Yes' : 'No';
  }
  return String(value);
}

export default function ConflictsScreen() {
  const router = useRouter();
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [choices, setChoices] = useState<Record<number, Record<string, 'local' | 'server'>>>({});

  useEffect(() => {
    setConflicts(getConflicts());
  }, []);

  const handleExpand = useCallback((conflict: SyncConflict) => {
    if (expandedId === conflict.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(conflict.id);
    // Default: keep local for all fields, only if we don't already have choices
    setChoices((prev) => {
      if (prev[conflict.id]) return prev;
      const defaults: Record<string, 'local' | 'server'> = {};
      for (const f of conflict.conflicting_fields) defaults[f] = 'local';
      return { ...prev, [conflict.id]: defaults };
    });
  }, [expandedId]);

  const setChoice = useCallback(
    (conflictId: number, field: string, side: 'local' | 'server') => {
      Haptics.selectionAsync().catch(() => {});
      setChoices((prev) => ({
        ...prev,
        [conflictId]: { ...(prev[conflictId] ?? {}), [field]: side },
      }));
    },
    [],
  );

  const handleResolve = useCallback(
    (conflict: SyncConflict) => {
      const c = choices[conflict.id] ?? {};
      // Fall back to "local" for any unselected field — same default the
      // expand handler set up.
      const filled: Record<string, 'local' | 'server'> = {};
      for (const f of conflict.conflicting_fields) filled[f] = c[f] ?? 'local';
      resolveConflict(conflict.id, filled);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setConflicts((prev) => prev.filter((x) => x.id !== conflict.id));
      setExpandedId(null);
    },
    [choices],
  );

  const handleKeepAll = useCallback((conflict: SyncConflict, side: 'local' | 'server') => {
    if (side === 'local') resolveConflictKeepLocal(conflict.id);
    else resolveConflictTakeServer(conflict.id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setConflicts((prev) => prev.filter((x) => x.id !== conflict.id));
    setExpandedId(null);
  }, []);

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
        <Text style={styles.topBarTitle}>Sync conflicts</Text>
        <View style={styles.topBarBtn} />
      </View>

      {conflicts.length === 0 ? (
        <View style={styles.empty}>
          <Icon sf="checkmark.circle.fill" size={56} color={colors.success} />
          <Text style={styles.emptyTitle}>All resolved</Text>
          <Text style={styles.emptyText}>No sync conflicts to resolve.</Text>
        </View>
      ) : (
        <FlatList
          data={conflicts}
          keyExtractor={(c) => String(c.id)}
          contentContainerStyle={styles.list}
          renderItem={({ item: conflict }) => (
            <ConflictCard
              conflict={conflict}
              expanded={expandedId === conflict.id}
              choices={choices[conflict.id] ?? {}}
              onExpand={() => handleExpand(conflict)}
              onChoice={(field, side) => setChoice(conflict.id, field, side)}
              onResolve={() => handleResolve(conflict)}
              onKeepAll={(side) => handleKeepAll(conflict, side)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function ConflictCard({
  conflict,
  expanded,
  choices,
  onExpand,
  onChoice,
  onResolve,
  onKeepAll,
}: {
  conflict: SyncConflict;
  expanded: boolean;
  choices: Record<string, 'local' | 'server'>;
  onExpand: () => void;
  onChoice: (field: string, side: 'local' | 'server') => void;
  onResolve: () => void;
  onKeepAll: (side: 'local' | 'server') => void;
}) {
  const itemName = conflict.local_data.name ?? conflict.row_id;
  const tableLabel = TABLE_LABEL[conflict.table_name] ?? conflict.table_name;
  const fieldCount = conflict.conflicting_fields.length;

  return (
    <View style={styles.card}>
      <Pressable onPress={onExpand} style={styles.cardHeader}>
        <ResourceIcon
          table={conflict.table_name as ResourceTable}
          category={(conflict.local_data.category ?? null) as Category | null}
          size={36}
          background={colors.warningBg}
        />
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {itemName}
          </Text>
          <Text style={styles.cardSubtitle} numberOfLines={1}>
            {tableLabel} · {fieldCount} conflicting field{fieldCount > 1 ? 's' : ''}
          </Text>
        </View>
        <Icon sf={expanded ? 'chevron.up' : 'chevron.down'} size={14} color={colors.textMuted} />
      </Pressable>

      {expanded && (
        <View style={styles.detail}>
          <View style={styles.quickActions}>
            <Pressable
              style={({ pressed }) => [styles.quickBtn, pressed && { opacity: 0.7 }]}
              onPress={() => onKeepAll('local')}
            >
              <Text style={styles.quickBtnText}>Keep all mine</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.quickBtn, pressed && { opacity: 0.7 }]}
              onPress={() => onKeepAll('server')}
            >
              <Text style={styles.quickBtnText}>Take all server</Text>
            </Pressable>
          </View>

          <View style={styles.diff}>
            {conflict.conflicting_fields.map((field) => {
              const choice = choices[field] ?? 'local';
              const localVal = conflict.local_data[field];
              const serverVal = conflict.server_data[field];
              return (
                <View key={field} style={styles.diffField}>
                  <Text style={styles.diffFieldLabel}>{prettyField(field)}</Text>
                  <Pressable
                    onPress={() => onChoice(field, 'local')}
                    style={[
                      styles.diffMinus,
                      choice === 'local' ? styles.diffSelected : styles.diffUnselected,
                    ]}
                  >
                    <View style={styles.diffSidebar}>
                      <Text style={styles.diffMinusSign}>−</Text>
                      <Text style={[styles.diffSideLabel, { color: colors.dangerText }]}>
                        Mine
                      </Text>
                    </View>
                    <Text style={styles.diffMinusText} numberOfLines={2}>
                      {formatValue(field, localVal)}
                    </Text>
                    {choice === 'local' && (
                      <Icon sf="checkmark.circle.fill" size={16} color={colors.dangerText} />
                    )}
                  </Pressable>
                  <Pressable
                    onPress={() => onChoice(field, 'server')}
                    style={[
                      styles.diffPlus,
                      choice === 'server' ? styles.diffSelected : styles.diffUnselected,
                    ]}
                  >
                    <View style={styles.diffSidebar}>
                      <Text style={styles.diffPlusSign}>+</Text>
                      <Text style={[styles.diffSideLabel, { color: colors.successText }]}>
                        Server
                      </Text>
                    </View>
                    <Text style={styles.diffPlusText} numberOfLines={2}>
                      {formatValue(field, serverVal)}
                    </Text>
                    {choice === 'server' && (
                      <Icon sf="checkmark.circle.fill" size={16} color={colors.successText} />
                    )}
                  </Pressable>
                </View>
              );
            })}
          </View>

          <Pressable
            style={({ pressed }) => [styles.resolveBtn, pressed && { opacity: 0.85 }]}
            onPress={onResolve}
          >
            <Text style={styles.resolveBtnText}>Resolve with selected</Text>
          </Pressable>
        </View>
      )}
    </View>
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
  topBarTitle: { ...typography.headline, color: colors.text, flex: 1, textAlign: 'center' },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingBottom: 80,
  },
  emptyTitle: { ...typography.title2, color: colors.text },
  emptyText: { ...typography.subhead, color: colors.textMuted, textAlign: 'center' },

  list: { padding: spacing.lg, gap: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md + 2,
  },
  cardBody: { flex: 1, gap: 2 },
  cardTitle: { ...typography.headline, color: colors.text },
  cardSubtitle: { ...typography.footnote, color: colors.textMuted },

  detail: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    padding: spacing.md,
    paddingTop: spacing.sm,
  },
  quickActions: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  quickBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.palette.neutral[100],
    alignItems: 'center',
  },
  quickBtnText: { ...typography.footnote, color: colors.text, fontWeight: '700' },

  diff: { gap: 12 },
  diffField: { gap: 4 },
  diffFieldLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  diffSidebar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: 70,
  },
  diffSideLabel: {
    ...typography.caption,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  diffMinus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.dangerBg,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  diffMinusSign: {
    ...typography.footnote,
    color: colors.dangerText,
    fontFamily: 'Menlo',
    fontWeight: '700',
    width: 12,
    textAlign: 'center',
  },
  diffMinusText: {
    ...typography.footnote,
    color: colors.dangerText,
    flex: 1,
    fontWeight: '500',
  },
  diffPlus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.successBg,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  diffPlusSign: {
    ...typography.footnote,
    color: colors.successText,
    fontFamily: 'Menlo',
    fontWeight: '700',
    width: 12,
    textAlign: 'center',
  },
  diffPlusText: {
    ...typography.footnote,
    color: colors.successText,
    flex: 1,
    fontWeight: '500',
  },
  diffSelected: {
    borderColor: colors.text,
  },
  diffUnselected: {
    opacity: 0.5,
  },

  resolveBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  resolveBtnText: { ...typography.bodyStrong, color: colors.textOnPrimary },
});
