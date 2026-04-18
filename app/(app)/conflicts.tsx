// ============================================================================
// Stockr – Sync conflict resolution screen
// Shows unresolved conflicts from bidirectional sync. User resolves
// per-field: pick local or server value for each conflicting field.
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  getConflicts,
  resolveConflict,
  resolveConflictKeepLocal,
  resolveConflictTakeServer,
  type SyncConflict,
} from '@/src/lib/sync';
import { colors, radius, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';

export default function ConflictsScreen() {
  const router = useRouter();
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [choices, setChoices] = useState<Record<string, 'local' | 'server'>>({});

  useEffect(() => {
    setConflicts(getConflicts());
  }, []);

  const handleExpand = (conflict: SyncConflict) => {
    if (expandedId === conflict.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(conflict.id);
    // Default: keep local for all fields
    const defaults: Record<string, 'local' | 'server'> = {};
    for (const f of conflict.conflicting_fields) defaults[f] = 'local';
    setChoices(defaults);
  };

  const handleResolve = (conflict: SyncConflict) => {
    resolveConflict(conflict.id, choices);
    setConflicts((prev) => prev.filter((c) => c.id !== conflict.id));
    setExpandedId(null);
  };

  const handleKeepAll = (conflict: SyncConflict, side: 'local' | 'server') => {
    if (side === 'local') resolveConflictKeepLocal(conflict.id);
    else resolveConflictTakeServer(conflict.id);
    setConflicts((prev) => prev.filter((c) => c.id !== conflict.id));
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={({ pressed }) => [styles.topBarBtn, pressed && { opacity: 0.5 }]}>
          <Icon sf="chevron.left" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.topBarTitle}>Sync conflicts</Text>
        <View style={styles.topBarBtn} />
      </View>

      {conflicts.length === 0 ? (
        <View style={styles.center}>
          <Icon sf="checkmark.circle.fill" size={48} color={colors.success} />
          <Text style={styles.emptyTitle}>All resolved</Text>
          <Text style={styles.emptyText}>No sync conflicts to resolve.</Text>
        </View>
      ) : (
        <FlatList
          data={conflicts}
          keyExtractor={(c) => String(c.id)}
          contentContainerStyle={styles.list}
          renderItem={({ item: conflict }) => {
            const expanded = expandedId === conflict.id;
            const itemName = conflict.local_data.name ?? conflict.row_id;

            return (
              <View style={styles.card}>
                <Pressable onPress={() => handleExpand(conflict)} style={styles.cardHeader}>
                  <Icon sf="exclamationmark.triangle.fill" size={20} color={colors.warningText} />
                  <View style={styles.cardBody}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{itemName}</Text>
                    <Text style={styles.cardSubtitle}>
                      {conflict.table_name} · {conflict.conflicting_fields.length} conflicting field{conflict.conflicting_fields.length > 1 ? 's' : ''}
                    </Text>
                  </View>
                  <Icon sf={expanded ? 'chevron.up' : 'chevron.down'} size={14} color={colors.textMuted} />
                </Pressable>

                {expanded && (
                  <View style={styles.detail}>
                    {/* Quick actions */}
                    <View style={styles.quickActions}>
                      <Pressable style={styles.quickBtn} onPress={() => handleKeepAll(conflict, 'local')}>
                        <Text style={styles.quickBtnText}>Keep all mine</Text>
                      </Pressable>
                      <Pressable style={styles.quickBtn} onPress={() => handleKeepAll(conflict, 'server')}>
                        <Text style={styles.quickBtnText}>Take all server</Text>
                      </Pressable>
                    </View>

                    {/* Per-field comparison */}
                    {conflict.conflicting_fields.map((field) => {
                      const localVal = String(conflict.local_data[field] ?? '—');
                      const serverVal = String(conflict.server_data[field] ?? '—');
                      const choice = choices[field] ?? 'local';

                      return (
                        <View key={field} style={styles.fieldRow}>
                          <Text style={styles.fieldName}>{field}</Text>
                          <Pressable
                            onPress={() => setChoices((p) => ({ ...p, [field]: 'local' }))}
                            style={[styles.fieldOption, choice === 'local' && styles.fieldOptionActive]}
                          >
                            <Text style={styles.fieldLabel}>Mine</Text>
                            <Text style={styles.fieldValue} numberOfLines={1}>{localVal}</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => setChoices((p) => ({ ...p, [field]: 'server' }))}
                            style={[styles.fieldOption, choice === 'server' && styles.fieldOptionActive]}
                          >
                            <Text style={styles.fieldLabel}>Server</Text>
                            <Text style={styles.fieldValue} numberOfLines={1}>{serverVal}</Text>
                          </Pressable>
                        </View>
                      );
                    })}

                    <Pressable style={styles.resolveBtn} onPress={() => handleResolve(conflict)}>
                      <Text style={styles.resolveBtnText}>Resolve with selected</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xxl, gap: spacing.md },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  topBarBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  topBarTitle: { ...typography.headline, color: colors.text, flex: 1, textAlign: 'center' },
  emptyTitle: { ...typography.title3, color: colors.text },
  emptyText: { ...typography.subhead, color: colors.textMuted },
  list: { padding: spacing.lg, gap: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md + 2 },
  cardBody: { flex: 1, gap: 2 },
  cardTitle: { ...typography.headline, color: colors.text },
  cardSubtitle: { ...typography.footnote, color: colors.textMuted },
  detail: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, padding: spacing.md },
  quickActions: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  quickBtn: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.palette.neutral[100], alignItems: 'center' },
  quickBtnText: { ...typography.footnote, color: colors.text, fontWeight: '700' },
  fieldRow: { marginBottom: spacing.sm },
  fieldName: { ...typography.caption, color: colors.textMuted, fontWeight: '700', letterSpacing: 0.5, marginBottom: spacing.xs },
  fieldOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs + 2, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, marginBottom: 4 },
  fieldOptionActive: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  fieldLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '700', width: 50 },
  fieldValue: { ...typography.body, color: colors.text, flex: 1 },
  resolveBtn: { marginTop: spacing.sm, paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center' },
  resolveBtnText: { ...typography.bodyStrong, color: colors.textOnPrimary },
});
