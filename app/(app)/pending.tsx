// ============================================================================
// Kalta – Pending changes screen
// Shows the contents of the local sync queue: every mutation that is
// waiting to push to Supabase. Useful when offline so the user can see
// exactly what hasn't synced yet, or online to debug a stuck queue.
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  getLastPushError,
  getPendingEntries,
  revertAllPendingEntries,
  revertPendingEntry,
  subscribeSyncStatus,
  type PendingEntry,
} from '@/src/lib/sync';
import { recalcBoxCacheLocal } from '@/src/lib/localWrites';
import { useNetworkStatus } from '@/src/lib/useNetworkStatus';
import { colors, radius, spacing, typography } from '@/src/theme';
import { Icon, type SFSymbolName } from '@/src/components/Icon';
import { ResourceIconWithOp, type ResourceTable } from '@/src/components/ResourceIcon';
import type { Category } from '@/src/types/database';

const OPERATION_LABEL: Record<PendingEntry['operation'], string> = {
  INSERT: 'Added',
  UPDATE: 'Updated',
  DELETE: 'Deleted',
};

const TABLE_LABEL: Record<string, string> = {
  warehouses: 'Warehouse',
  boxes: 'Box',
  items: 'Item',
  custom_products: 'Custom product',
  inventory_sessions: 'Inventory session',
  inventory_lines: 'Inventory line',
};

export default function PendingScreen() {
  const router = useRouter();
  const isOnline = useNetworkStatus();
  const [entries, setEntries] = useState<PendingEntry[]>([]);
  const [pushError, setPushError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(() => {
    try {
      setEntries(getPendingEntries());
      setPushError(getLastPushError());
    } catch {
      /* db not ready */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh when sync status changes (e.g., entries get pushed)
  useEffect(() => {
    return subscribeSyncStatus(() => refresh());
  }, [refresh]);

  // Periodic refresh in case external mutations arrive while screen is open
  useEffect(() => {
    const id = setInterval(refresh, 5_000);
    return () => clearInterval(id);
  }, [refresh]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refresh();
    setTimeout(() => setRefreshing(false), 300);
  }, [refresh]);

  const grouped = useMemo(() => groupByTable(entries), [entries]);

  const handleRevertAll = useCallback(() => {
    if (entries.length === 0) return;
    Alert.alert(
      'Revert all changes?',
      `This will undo all ${entries.length} pending change${entries.length === 1 ? '' : 's'} and restore your local data to its last synced state.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revert all',
          style: 'destructive',
          onPress: () => {
            try {
              const result = revertAllPendingEntries();
              for (const boxId of result.affectedBoxIds) recalcBoxCacheLocal(boxId);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              if (result.skipped > 0) {
                Alert.alert(
                  'Some changes kept',
                  `Reverted ${result.reverted}. Skipped ${result.skipped} that couldn't be undone (no snapshot).`,
                );
              }
              refresh();
            } catch (e: any) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
              Alert.alert('Cannot revert', e?.message ?? 'Unknown error');
            }
          },
        },
      ],
    );
  }, [entries.length, refresh]);

  const handleRevert = useCallback(
    (entry: PendingEntry) => {
      const message = formatRevertMessage(entry);
      const title =
        entry.change_count > 1
          ? `Revert ${entry.change_count} changes?`
          : 'Revert change?';
      Alert.alert(title, message, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revert',
          style: 'destructive',
          onPress: () => {
            const affectedBoxIds = new Set<string>();
            let reverted = 0;
            let skipped = 0;
            // Iterate newest-first so that an UPDATE chain unwinds in
            // reverse, keeping each entry's before-snapshot consistent.
            for (const entryId of entry.entry_ids) {
              try {
                const result = revertPendingEntry(entryId);
                if (result.boxId) affectedBoxIds.add(result.boxId);
                reverted++;
              } catch {
                skipped++;
              }
            }
            for (const boxId of affectedBoxIds) recalcBoxCacheLocal(boxId);
            if (reverted > 0) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            } else {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
              Alert.alert(
                'Cannot revert',
                'No before-snapshots were available for this change.',
              );
            }
            refresh();
          },
        },
      ]);
    },
    [refresh],
  );

  const handleNavigate = useCallback(
    (entry: PendingEntry) => {
      if (!entry.nav) return;
      // `replace` instead of `push` so the back button on the resource
      // screen returns to wherever the user came from before opening
      // pending changes (typically the warehouses list), not back into
      // the pending screen — that creates a confusing loop when the
      // user is bouncing between several pending entries.
      router.replace(entry.nav.href as any);
    },
    [router],
  );

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
        <Text style={styles.topBarTitle}>Pending changes</Text>
        <View style={styles.topBarBtn} />
      </View>

      {entries.length === 0 ? (
        <View style={styles.empty}>
          <Icon sf="checkmark.circle.fill" size={56} color={colors.success} />
          <Text style={styles.emptyTitle}>Everything synced</Text>
          <Text style={styles.emptyText}>
            All your local changes have been pushed to the cloud.
          </Text>
        </View>
      ) : (
        <FlatList
          data={grouped}
          keyExtractor={(g) => g.table}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          ListHeaderComponent={
            <View style={styles.summary}>
              <View style={styles.summaryHeader}>
                <Text style={styles.summaryTitle}>
                  {entries.length} change{entries.length === 1 ? '' : 's'} waiting to sync
                </Text>
                <Pressable
                  hitSlop={6}
                  onPress={handleRevertAll}
                  style={({ pressed }) => [styles.revertAllBtn, pressed && { opacity: 0.5 }]}
                >
                  <Icon sf="arrow.uturn.backward" size={13} color={colors.warningText} />
                  <Text style={styles.revertAllBtnText}>Revert all</Text>
                </Pressable>
              </View>
              <Text style={styles.summaryText}>
                {isOnline
                  ? 'These will push automatically. If they stay here, the sync may have failed — pull down to retry.'
                  : 'These will push when you go back online.'}
              </Text>
              {pushError && (
                <View style={styles.errorBox}>
                  <Icon sf="exclamationmark.triangle.fill" size={14} color={colors.warningText} />
                  <Text style={styles.errorText} numberOfLines={3}>
                    Last sync error: {pushError}
                  </Text>
                </View>
              )}
            </View>
          }
          renderItem={({ item: group }) => (
            <View style={styles.group}>
              <Text style={styles.groupTitle}>
                {TABLE_LABEL[group.table] ?? group.table} · {group.entries.length}
              </Text>
              {group.entries.map((entry) => (
                <PendingRow
                  key={entry.id}
                  entry={entry}
                  onRevert={() => handleRevert(entry)}
                  onNavigate={() => handleNavigate(entry)}
                />
              ))}
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function PendingRow({
  entry,
  onRevert,
  onNavigate,
}: {
  entry: PendingEntry;
  onRevert: () => void;
  onNavigate: () => void;
}) {
  const operationLabel = OPERATION_LABEL[entry.operation];
  const time = formatRelativeTime(entry.created_at);
  const isUpdate = entry.operation === 'UPDATE';
  const canRevert =
    entry.operation === 'INSERT' ||
    entry.operation === 'DELETE' ||
    (isUpdate && entry.before_values !== null);
  const canNavigate = entry.nav !== null && entry.operation !== 'INSERT' && entry.operation !== 'DELETE';

  const NameWrapper: any = canNavigate ? Pressable : View;
  const nameWrapperProps = canNavigate
    ? {
        onPress: onNavigate,
        hitSlop: 4,
        style: ({ pressed }: { pressed: boolean }) => [
          styles.rowNameWrap,
          pressed && { opacity: 0.5 },
        ],
      }
    : { style: styles.rowNameWrap };

  return (
    <View style={styles.row}>
      <ResourceIconWithOp
        table={entry.table_name as ResourceTable}
        category={entry.category as Category | null}
        operation={entry.operation}
        size={36}
      />
      <View style={styles.rowBody}>
        <NameWrapper {...nameWrapperProps}>
          <Text
            style={[styles.rowName, canNavigate && styles.rowNameLink]}
            numberOfLines={1}
          >
            {entry.display_name}
          </Text>
          {canNavigate && (
            <Icon sf="chevron.right" size={11} color={colors.textSubtle} />
          )}
        </NameWrapper>
        {entry.context && (
          <Text style={styles.rowContext} numberOfLines={1}>
            {entry.context}
          </Text>
        )}
        {entry.change_count > 1 && (
          <Text style={styles.rowEditCount}>
            {entry.change_count} edits combined
          </Text>
        )}
        {isUpdate && entry.changed_fields && entry.changed_fields.length > 0 && (() => {
          // Drop no-op fields where the user "changed" something but the
          // value ended up identical (e.g. saving an unchanged edit sheet).
          // The queue still contains them but they're noise to render.
          const visible = entry.changed_fields.filter((f) => {
            const before = entry.before_values?.[f];
            const after = entry.field_values?.[f];
            if (!entry.before_values || !(f in entry.before_values)) return true;
            return formatValue(f, before) !== formatValue(f, after);
          });
          if (visible.length === 0) return null;
          return (
            <View style={styles.diff}>
              {visible.map((f) => {
                const before = entry.before_values?.[f];
                const after = entry.field_values?.[f];
                const hasBefore = entry.before_values && f in entry.before_values;
                return (
                  <View key={f} style={styles.diffField}>
                    <Text style={styles.diffFieldLabel}>{prettyField(f)}</Text>
                    {hasBefore && (
                      <View style={styles.diffMinus}>
                        <Text style={styles.diffMinusSign}>−</Text>
                        <Text style={styles.diffMinusText} numberOfLines={2}>
                          {formatValue(f, before)}
                        </Text>
                      </View>
                    )}
                    <View style={styles.diffPlus}>
                      <Text style={styles.diffPlusSign}>+</Text>
                      <Text style={styles.diffPlusText} numberOfLines={2}>
                        {formatValue(f, after)}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          );
        })()}
      </View>
      <View style={styles.rowMeta}>
        <Text style={styles.rowOperation}>{operationLabel}</Text>
        <Text style={styles.rowTime}>{time}</Text>
        {canRevert && (
          <Pressable
            hitSlop={8}
            onPress={onRevert}
            style={({ pressed }) => [styles.revertBtn, pressed && { opacity: 0.5 }]}
          >
            <Icon sf="arrow.uturn.backward" size={13} color={colors.primary} />
            <Text style={styles.revertBtnText}>Revert</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function formatRevertMessage(entry: PendingEntry): string {
  const itemName = entry.display_name;
  if (entry.operation === 'INSERT') {
    return `Permanently delete the new ${TABLE_LABEL[entry.table_name]?.toLowerCase() ?? 'record'} "${itemName}"? This cannot be undone.`;
  }
  if (entry.operation === 'DELETE') {
    return `Restore the deleted ${TABLE_LABEL[entry.table_name]?.toLowerCase() ?? 'record'} "${itemName}"?`;
  }
  // UPDATE
  if (entry.changed_fields && entry.changed_fields.length === 1) {
    const f = entry.changed_fields[0];
    const before = formatValue(f, entry.before_values?.[f]);
    const after = formatValue(f, entry.field_values?.[f]);
    return `Restore ${prettyField(f).toLowerCase()} of "${itemName}" from "${after}" back to "${before}"?`;
  }
  return `Restore ${entry.changed_fields?.length ?? 0} fields of "${itemName}" to their previous values?`;
}

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
    // Display the date part; strip time if present.
    return ts.split('T')[0]?.split(' ')[0] ?? ts;
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
  }
  return String(value);
}

function groupByTable(entries: PendingEntry[]): { table: string; entries: PendingEntry[] }[] {
  const order = ['warehouses', 'boxes', 'items', 'custom_products', 'inventory_sessions', 'inventory_lines'];
  const groups = new Map<string, PendingEntry[]>();
  for (const e of entries) {
    const list = groups.get(e.table_name) ?? [];
    list.push(e);
    groups.set(e.table_name, list);
  }
  return order
    .filter((t) => groups.has(t))
    .map((t) => ({ table: t, entries: groups.get(t)! }));
}

function formatRelativeTime(iso: string): string {
  // SQLite default datetime returns "YYYY-MM-DD HH:MM:SS" without timezone.
  // Treat as UTC for the purposes of relative-time math; server timestamps
  // are also UTC and the user only sees a coarse "X ago" display anyway.
  const ts = iso.includes('T') ? Date.parse(iso) : Date.parse(iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(ts)) return '';
  const diff = Math.max(0, (Date.now() - ts) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
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
  emptyText: { ...typography.subhead, color: colors.textMuted, textAlign: 'center', maxWidth: 280 },

  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  summary: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  summaryTitle: { ...typography.headline, color: colors.text, flexShrink: 1 },
  summaryText: { ...typography.subhead, color: colors.textMuted, lineHeight: 20 },
  revertAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.warningBg,
    borderRadius: radius.sm,
  },
  revertAllBtnText: {
    ...typography.caption,
    color: colors.warningText,
    fontWeight: '700',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs + 2,
    backgroundColor: colors.warningBg,
    padding: spacing.sm,
    borderRadius: radius.md,
    marginTop: spacing.xs,
  },
  errorText: {
    ...typography.footnote,
    color: colors.warningText,
    flex: 1,
    lineHeight: 16,
  },

  group: { gap: spacing.xs },
  groupTitle: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingTop: spacing.md + 4,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowBody: { flex: 1, gap: 2 },
  rowNameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingVertical: 1,
  },
  rowName: { ...typography.headline, color: colors.text },
  rowNameLink: { color: colors.primary },
  rowContext: { ...typography.footnote, color: colors.textMuted },
  rowEditCount: {
    ...typography.caption,
    color: colors.textSubtle,
    fontStyle: 'italic',
    marginTop: 2,
  },
  rowMeta: { alignItems: 'flex-end', gap: 2 },
  rowOperation: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
  },
  rowTime: { ...typography.footnote, color: colors.textSubtle },
  revertBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingTop: 6,
    paddingHorizontal: 8,
    paddingBottom: 4,
  },
  revertBtnText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },

  diff: {
    marginTop: 10,
    gap: 8,
  },
  diffField: { gap: 3 },
  diffFieldLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  diffMinus: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: colors.dangerBg,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
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
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: colors.successBg,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
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
});
