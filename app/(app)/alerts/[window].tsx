// ============================================================================
// Kalta – Expiry alerts list
// Deep-link target for the grouped expiry notifications. Shows items across
// all warehouses the user is a member of, filtered to daysUntil(expiry)
// <= `window`. Sorted by urgency (soonest first). Tap → open box detail.
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
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  getActiveUserId,
  getMyWarehouses,
  listAllItemsInWarehouse,
} from '@/src/lib/supabase';
import { setAppBadge } from '@/src/lib/notifications';
import type { ItemWithBox } from '@/src/types/database';
import { EXPIRY_COLORS, daysUntil, getExpiryStatus } from '@/src/types/database';
import { colors, radius, spacing, typography } from '@/src/theme';
import { Card } from '@/src/components/Card';
import { Icon } from '@/src/components/Icon';

interface Row extends ItemWithBox {
  warehouse_id: string;
  warehouse_name: string;
  days_left: number;
}

export default function AlertsScreen() {
  const router = useRouter();
  const { window: windowParam } = useLocalSearchParams<{ window: string }>();
  const windowDays = Math.max(0, parseInt(windowParam ?? '60', 10) || 60);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const uid = await getActiveUserId();
    if (!uid) return;
    const warehouses = await getMyWarehouses(uid);
    const all: Row[] = [];
    for (const wh of warehouses) {
      const items = await listAllItemsInWarehouse(wh.id);
      for (const it of items) {
        if (!it.expiry_date) continue;
        const d = daysUntil(it.expiry_date);
        if (d <= windowDays) {
          all.push({
            ...it,
            warehouse_id: wh.id,
            warehouse_name: wh.name,
            days_left: d,
          });
        }
      }
    }
    all.sort((a, b) => a.days_left - b.days_left);
    setRows(all);
  }, [windowDays]);

  useEffect(() => {
    load().catch(() => {}).finally(() => setLoading(false));
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
      // Treat opening the alerts list as "seen" — clear the icon badge so
      // it doesn't keep nagging after the user has looked at the items.
      // It'll re-populate on next Warehouses-list focus if things are
      // still due to expire.
      setAppBadge(0).catch(() => {});
    }, [load]),
  );

  const title = windowDays === 1
    ? 'Expiring within a day'
    : `Expiring within ${windowDays} days`;

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
        <Text style={styles.topBarTitle}>{title}</Text>
        <View style={styles.topBarBtn} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.center}>
          <Icon sf="checkmark.seal" size={48} color={colors.textSubtle} />
          <Text style={styles.emptyTitle}>All clear</Text>
          <Text style={styles.emptyText}>
            No items expiring within {windowDays} day{windowDays === 1 ? '' : 's'}.
          </Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <AlertRow
              row={item}
              onPress={() =>
                router.push(`/warehouse/${item.warehouse_id}/box/${item.box_id}` as any)
              }
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function AlertRow({ row, onPress }: { row: Row; onPress: () => void }) {
  const { days_left } = row;
  const status = getExpiryStatus(row.expiry_date);
  const palette = status === 'none' ? EXPIRY_COLORS.ok : EXPIRY_COLORS[status];
  const daysLabel =
    days_left < 0 ? `${Math.abs(days_left)}d overdue`
      : days_left === 0 ? 'today'
        : days_left === 1 ? 'tomorrow'
          : `${days_left}d`;

  return (
    <Card onPress={onPress} style={styles.card}>
      <View style={[styles.dayPill, { backgroundColor: palette.bg }]}>
        <Text style={[styles.dayPillText, { color: palette.fg }]}>{daysLabel}</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{row.name}</Text>
        <Text style={styles.sub} numberOfLines={1}>
          {row.box_name || '—'} · {row.warehouse_name}
        </Text>
      </View>
      <Icon sf="chevron.right" size={14} color={colors.textSubtle} />
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  topBarBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topBarTitle: { ...typography.headline, color: colors.text, flex: 1, textAlign: 'center' },

  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
  },
  dayPill: {
    minWidth: 56,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    alignItems: 'center',
  },
  dayPillText: {
    ...typography.caption,
    fontWeight: '700',
  },
  body: { flex: 1, gap: 2 },
  name: { ...typography.headline, color: colors.text },
  sub: { ...typography.footnote, color: colors.textMuted },

  emptyTitle: { ...typography.title3, color: colors.text, marginTop: spacing.md },
  emptyText: { ...typography.subhead, color: colors.textMuted, textAlign: 'center' },
});
