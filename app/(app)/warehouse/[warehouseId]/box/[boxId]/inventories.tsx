// ============================================================================
// Kalta – Inventory history for a box
// Lists all completed inventory sessions with expandable detail (found /
// partial / missing lines).
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  getBoxById,
  getInventoryLines,
  listInventorySessions,
} from '@/src/lib/supabase';
import type { InventoryLine, InventorySession } from '@/src/types/database';
import { colors, radius, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';

type SessionWithUser = InventorySession & {
  user: { display_name: string | null; email: string | null };
};

function formatSessionDate(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const year = d.getFullYear();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${day}. ${month}. ${year} ${h}:${m}`;
}

function userName(u: { display_name: string | null; email: string | null }): string {
  return u.display_name ?? u.email ?? 'Unknown';
}

export default function InventoriesScreen() {
  const router = useRouter();
  const { boxId } = useLocalSearchParams<{ boxId: string }>();
  const [boxName, setBoxName] = useState('');
  const [sessions, setSessions] = useState<SessionWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, InventoryLine[]>>({});
  const [loadingLines, setLoadingLines] = useState<string | null>(null);

  useEffect(() => {
    if (!boxId) return;
    (async () => {
      try {
        const [box, sess] = await Promise.all([
          getBoxById(boxId),
          listInventorySessions(boxId),
        ]);
        setBoxName(box?.name ?? 'Box');
        setSessions(sess as any);
      } catch (e: any) {
        setError(e?.message ?? 'Unknown error loading inventories');
      } finally {
        setLoading(false);
      }
    })();
  }, [boxId]);

  const toggleExpand = async (sessionId: string) => {
    if (expandedId === sessionId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(sessionId);
    if (!lines[sessionId]) {
      try {
        setLoadingLines(sessionId);
        const l = await getInventoryLines(sessionId);
        setLines((prev) => ({ ...prev, [sessionId]: l }));
      } catch {
        // ignore
      } finally {
        setLoadingLines(null);
      }
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

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
        <Text style={styles.topBarTitle}>Inventories: {boxName}</Text>
        <View style={styles.topBarBtn} />
      </View>

      {error ? (
        <View style={styles.center}>
          <Icon sf="exclamationmark.triangle.fill" size={48} color={colors.danger} />
          <Text style={styles.emptyTitle}>Error loading inventories</Text>
          <Text style={styles.emptyText}>{error}</Text>
        </View>
      ) : sessions.length === 0 ? (
        <View style={styles.center}>
          <Icon sf="clipboard" size={64} color={colors.textSubtle} />
          <Text style={styles.emptyTitle}>No inventories yet</Text>
          <Text style={styles.emptyText}>
            Run an inventory check from the box detail to start tracking.
          </Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.list}
          renderItem={({ item: session }) => {
            const expanded = expandedId === session.id;
            const sessionLines = lines[session.id];
            const isLoadingThis = loadingLines === session.id;

            return (
              <View style={styles.sessionCard}>
                <Pressable
                  onPress={() => toggleExpand(session.id)}
                  style={({ pressed }) => [styles.sessionHeader, pressed && { opacity: 0.7 }]}
                >
                  <View style={styles.sessionHeaderBody}>
                    <Text style={styles.sessionDate}>
                      {formatSessionDate(session.completed_at ?? session.created_at)}
                    </Text>
                    <Text style={styles.sessionUser}>
                      by {userName(session.user)}
                    </Text>
                  </View>
                  <View style={styles.sessionCounts}>
                    {session.found_count > 0 && (
                      <View style={styles.sessionCountBadge}>
                        <Text style={[styles.sessionCountText, { color: colors.success }]}>
                          {session.found_count} ✓
                        </Text>
                      </View>
                    )}
                    {session.missing_count > 0 && (
                      <View style={[styles.sessionCountBadge, { backgroundColor: colors.dangerBg }]}>
                        <Text style={[styles.sessionCountText, { color: colors.danger }]}>
                          {session.missing_count} ✗
                        </Text>
                      </View>
                    )}
                  </View>
                  <Icon
                    sf={expanded ? 'chevron.up' : 'chevron.down'}
                    size={16}
                    color={colors.textMuted}
                  />
                </Pressable>

                {expanded && (
                  <View style={styles.sessionDetail}>
                    {isLoadingThis ? (
                      <ActivityIndicator color={colors.primary} style={{ paddingVertical: spacing.md }} />
                    ) : sessionLines ? (
                      sessionLines.map((line) => (
                        <View key={line.id} style={styles.lineRow}>
                          <Icon
                            sf={
                              line.status === 'found'
                                ? 'checkmark.circle.fill'
                                : line.status === 'partial'
                                  ? 'exclamationmark.circle.fill'
                                  : 'xmark.circle.fill'
                            }
                            size={16}
                            color={
                              line.status === 'found'
                                ? colors.success
                                : line.status === 'partial'
                                  ? colors.warningText
                                  : colors.danger
                            }
                          />
                          <Text style={styles.lineName} numberOfLines={1}>
                            {line.item_name}
                          </Text>
                          <Text style={styles.lineQty}>
                            {line.status === 'missing'
                              ? `0 / ${line.item_quantity}`
                              : `${line.found_quantity} / ${line.item_quantity}`}
                            {' '}{line.item_unit}
                          </Text>
                        </View>
                      ))
                    ) : null}
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
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
    gap: spacing.md,
  },
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
  emptyTitle: {
    ...typography.title3,
    color: colors.text,
  },
  emptyText: {
    ...typography.subhead,
    color: colors.textMuted,
    textAlign: 'center',
  },
  list: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sessionCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md + 2,
    gap: spacing.sm,
  },
  sessionHeaderBody: {
    flex: 1,
    gap: 2,
  },
  sessionDate: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  sessionUser: {
    ...typography.footnote,
    color: colors.textMuted,
  },
  sessionCounts: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  sessionCountBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.successBg,
  },
  sessionCountText: {
    ...typography.caption,
    fontWeight: '700',
  },
  sessionDetail: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs + 2,
  },
  lineName: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  lineQty: {
    ...typography.footnote,
    color: colors.textMuted,
    fontWeight: '600',
  },
});
