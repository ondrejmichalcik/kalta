// ============================================================================
// Stockr – Items tab
// Flat cross-box expiring timeline. Every item in the current warehouse,
// sorted by nearest expiry. Tap a row to edit the item in-place via the
// shared ItemEditSheet.
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import {
  ensureWarehouse,
  listAllItemsInWarehouse,
  supabase,
} from '@/src/lib/supabase';
import type { ItemWithBox, Warehouse } from '@/src/types/database';
import {
  EXPIRY_COLORS,
  formatExpiry,
  getExpiryStatus,
} from '@/src/types/database';
import { colors, radius, spacing, typography } from '@/src/theme';
import { Card } from '@/src/components/Card';
import { Icon } from '@/src/components/Icon';
import { ListHeader } from '@/src/components/ListHeader';
import { StatusDot } from '@/src/components/StatusDot';
import { ItemEditSheet } from '@/src/components/ItemEditSheet';

const TAB_BAR_HEIGHT = 84;

export default function ItemsScreen() {
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);
  const [items, setItems] = useState<ItemWithBox[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<ItemWithBox | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess.session?.user.id;
      if (!userId) return;
      const wh = await ensureWarehouse(userId);
      setWarehouse(wh);
      const rows = await listAllItemsInWarehouse(wh.id);
      setItems(rows);
    } catch (e: any) {
      setError(e?.message ?? 'Cannot load items.');
      throw e;
    }
  }, []);

  useEffect(() => {
    load()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } catch {
      /* error is in state */
    } finally {
      setRefreshing(false);
    }
  };

  const sortedItems = useMemo(() => {
    // listAllItemsInWarehouse already orders by expiry_date ASC nulls last,
    // but enforce the full status order (expired first) in memory.
    return [...items].sort((a, b) => {
      const order: Record<ReturnType<typeof getExpiryStatus>, number> = {
        expired: 0,
        critical: 1,
        soon: 2,
        ok: 3,
        none: 4,
      };
      const sa = getExpiryStatus(a.expiry_date);
      const sb = getExpiryStatus(b.expiry_date);
      if (sa !== sb) return order[sa] - order[sb];
      if (a.expiry_date && b.expiry_date) {
        return a.expiry_date.localeCompare(b.expiry_date);
      }
      return a.name.localeCompare(b.name);
    });
  }, [items]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error && items.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Icon brand="warning" size={96} style={styles.errorIcon} />
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ListHeader
        title="Items"
        subtitle="Sorted by nearest expiry"
        actions={[
          { sfIcon: 'magnifyingglass', onPress: () => {}, label: 'Search' },
          { sfIcon: 'line.3.horizontal.decrease', onPress: () => {}, label: 'Filter' },
        ]}
      />

      <FlatList
        data={sortedItems}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.textMuted}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon brand="inbox" size={120} style={styles.emptyIcon} />
            <Text style={styles.emptyTitle}>No items yet</Text>
            <Text style={styles.emptyText}>
              Open a box and add your first items.
            </Text>
          </View>
        }
        renderItem={({ item }) => <ItemRow item={item} onPress={() => setEditingItem(item)} />}
      />

      <Modal
        visible={!!editingItem}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEditingItem(null)}
      >
        {editingItem && (
          <ItemEditSheet
            item={editingItem}
            onClose={() => setEditingItem(null)}
            onSaved={(updated) => {
              setItems((prev) =>
                prev.map((x) => (x.id === updated.id ? { ...updated, box_name: x.box_name } : x)),
              );
              setEditingItem(null);
            }}
            onDeleted={(itemId) => {
              setItems((prev) => prev.filter((x) => x.id !== itemId));
              setEditingItem(null);
            }}
          />
        )}
      </Modal>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// ItemRow — same pill style as BoxRow but with "in [Box name]" subtitle
// ---------------------------------------------------------------------------
function ItemRow({ item, onPress }: { item: ItemWithBox; onPress: () => void }) {
  const status = getExpiryStatus(item.expiry_date);
  const palette =
    status === 'none'
      ? { bg: colors.expiryNoneBg, fg: colors.expiryNoneText }
      : EXPIRY_COLORS[status];

  const qty = Number.isInteger(item.quantity) ? String(item.quantity) : item.quantity.toFixed(1);
  const subtitleParts = [`${qty} ${item.unit}`, `in ${item.box_name}`];

  return (
    <Card onPress={onPress} style={styles.card}>
      <StatusDot status={status} />
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.cardSubtitle} numberOfLines={1}>
          {subtitleParts.join(' · ')}
        </Text>
      </View>
      {item.expiry_date ? (
        <View style={[styles.badge, { backgroundColor: palette.bg }]}>
          <Text style={[styles.badgeText, { color: palette.fg }]} numberOfLines={1}>
            {formatExpiry(item.expiry_date)}
          </Text>
        </View>
      ) : null}
      <Icon sf="chevron.right" size={14} color={colors.textSubtle} />
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
  },
  errorIcon: { marginBottom: spacing.lg },
  errorTitle: {
    ...typography.title3,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  errorText: {
    ...typography.subhead,
    color: colors.textMuted,
    textAlign: 'center',
  },

  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: TAB_BAR_HEIGHT + 24,
    gap: spacing.sm + 2,
  },
  card: {
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md + 2,
  },
  cardBody: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    ...typography.headline,
    color: colors.text,
  },
  cardSubtitle: {
    ...typography.footnote,
    color: colors.textMuted,
  },
  badge: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.full,
    maxWidth: 110,
  },
  badgeText: {
    ...typography.caption,
    fontWeight: '700',
  },

  empty: {
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: spacing.xxl,
  },
  emptyIcon: { marginBottom: spacing.lg },
  emptyTitle: {
    ...typography.title2,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyText: {
    ...typography.subhead,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
