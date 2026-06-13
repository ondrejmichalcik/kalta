// ============================================================================
// Kalta – Use soon (FIFO rotation, Sprint 9)
// Lists items nearing or past expiry, nearest first, with quick "−1" / "Use
// all" actions so the household rotates stock (eat the soonest-expiring batch
// before it's wasted). Consuming a batch to zero removes the row.
// ============================================================================
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { consumeItem, listAllItemsInWarehouse } from '@/src/lib/supabase';
import {
  EXPIRY_COLORS,
  formatExpiry,
  formatItemQuantity,
  getExpiryStatus,
} from '@/src/types/database';
import type { ItemWithBox } from '@/src/types/database';
import { getCachedUri } from '@/src/lib/imageCache';
import { CATEGORY_SF } from '@/src/components/categoryIcons';
import { colors, radius, shadows, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';

export default function UseSoonScreen() {
  const router = useRouter();
  const { warehouseId } = useLocalSearchParams<{ warehouseId: string }>();
  const [items, setItems] = useState<ItemWithBox[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!warehouseId) return;
    try {
      const rows = await listAllItemsInWarehouse(warehouseId);
      // Everything with a date that's expired / critical / soon — i.e. worth
      // using before the ok/undated rest. Already sorted nearest-first.
      setItems(
        rows.filter((i) => {
          const s = getExpiryStatus(i.expiry_date);
          return s === 'expired' || s === 'critical' || s === 'soon';
        }),
      );
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

  const consume = (item: ItemWithBox, amount: number | 'all') => {
    Haptics.selectionAsync().catch(() => {});
    // Optimistic local update so the row reacts instantly.
    setItems((prev) =>
      prev
        .map((i) => {
          if (i.id !== item.id) return i;
          const next = amount === 'all' ? 0 : Math.max(0, i.quantity - amount);
          return { ...i, quantity: next };
        })
        .filter((i) => i.quantity > 0),
    );
    consumeItem(item.id, amount)
      .then(() => load())
      .catch(() => load());
  };

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
        <Text style={styles.topBarTitle}>Use soon</Text>
        <View style={styles.topBarBtn} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Icon sf="checkmark.seal.fill" size={40} color={colors.successText} />
          <Text style={styles.emptyTitle}>Nothing to use up</Text>
          <Text style={styles.emptyText}>No items are expiring in the next 90 days.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.intro}>
            Use the soonest-expiring first. Tap −1 as you use units, or “Use all” to clear a batch.
          </Text>
          {items.map((item) => {
            const status = getExpiryStatus(item.expiry_date);
            const palette =
              status === 'none'
                ? { bg: colors.expiryNoneBg, fg: colors.expiryNoneText }
                : EXPIRY_COLORS[status];
            return (
              <View key={item.id} style={styles.row}>
                {item.image_url ? (
                  <Image source={{ uri: getCachedUri(item.image_url)! }} style={styles.thumb} />
                ) : (
                  <View style={styles.iconWrap}>
                    <Icon
                      sf={item.category ? CATEGORY_SF[item.category] : 'shippingbox.fill'}
                      size={20}
                      color={colors.textMuted}
                    />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {formatItemQuantity(item)} · {item.box_name}
                  </Text>
                  <View style={[styles.badge, { backgroundColor: palette.bg }]}>
                    <Text style={[styles.badgeText, { color: palette.fg }]}>
                      {formatExpiry(item.expiry_date)}
                    </Text>
                  </View>
                </View>
                <View style={styles.actions}>
                  <Pressable
                    style={({ pressed }) => [styles.minusBtn, pressed && { opacity: 0.6 }]}
                    onPress={() => consume(item, 1)}
                  >
                    <Text style={styles.minusText}>−1</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.useAllBtn, pressed && { opacity: 0.6 }]}
                    onPress={() => consume(item, 'all')}
                  >
                    <Text style={styles.useAllText}>Use all</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
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
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyTitle: { ...typography.title3, color: colors.text, marginTop: spacing.sm },
  emptyText: { ...typography.subhead, color: colors.textMuted, textAlign: 'center' },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  intro: { ...typography.footnote, color: colors.textMuted, marginBottom: spacing.xs, lineHeight: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    ...shadows.sm,
  },
  thumb: { width: 40, height: 40, borderRadius: radius.sm + 2, resizeMode: 'contain' },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.sm + 2,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { ...typography.body, color: colors.text, fontWeight: '600' },
  meta: { ...typography.footnote, color: colors.textMuted, marginTop: 1 },
  badge: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  badgeText: { ...typography.caption, fontWeight: '700' },
  actions: { gap: spacing.xs + 2, alignItems: 'stretch' },
  minusBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  minusText: { ...typography.body, color: colors.text, fontWeight: '800' },
  useAllBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primarySubtle,
    alignItems: 'center',
  },
  useAllText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
});
