// ============================================================================
// Kalta – ShoppingCard
// Glanceable banner on the Boxes dashboard alongside ReadinessCard. Surfaces
// open shopping work so the user can reach the list without going through
// readiness. Hidden when the list is empty — no visual noise when nothing
// is in flight.
// ============================================================================
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { listShoppingList } from '@/src/lib/supabase';
import type { ShoppingListItem } from '@/src/types/database';
import { colors, radius, shadows, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';

export function ShoppingCard({
  warehouseId,
  onPress,
}: {
  warehouseId: string;
  /** Override the default tap-to-shopping navigation (used by callers that
   *  embed the card inside a modal and need to close it first). */
  onPress?: () => void;
}) {
  const router = useRouter();
  const [list, setList] = useState<ShoppingListItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!warehouseId) return;
    try {
      setList(await listShoppingList(warehouseId));
    } catch {
      /* non-fatal — card just stays hidden */
    } finally {
      setLoaded(true);
    }
  }, [warehouseId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!loaded || list.length === 0) return null;

  const toBuy = list.filter((i) => !i.checked).length;
  const toRestock = list.filter((i) => i.checked).length;

  // Tone reflects which half of the loop needs attention. Purchased items
  // sitting around (toRestock > 0) are the most actionable — they're already
  // bought, just waiting to be put away. So that wins the amber.
  const tone: 'amber' | 'neutral' = toRestock > 0 ? 'amber' : 'neutral';
  const style = tone === 'amber' ? toneAmber : toneNeutral;

  const headline =
    toRestock > 0
      ? `${toRestock} to restock`
      : `${toBuy} ${toBuy === 1 ? 'item' : 'items'} to buy`;

  const subParts: string[] = [];
  if (toBuy > 0) subParts.push(`${toBuy} to buy`);
  if (toRestock > 0 && toBuy > 0) {
    // headline already shows toRestock — sub only adds toBuy in this combo
  }
  if (toRestock > 0 && toBuy === 0) subParts.push('all purchased');

  const go = onPress ?? (() => router.push(`/warehouse/${warehouseId}/shopping` as any));

  return (
    <Pressable
      onPress={go}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: style.bg, borderColor: style.border },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Icon sf={toRestock > 0 ? 'bag.fill' : 'cart.fill'} size={20} color={style.fg} />
      <View style={styles.body}>
        <Text style={[styles.headline, { color: style.fg }]} numberOfLines={1}>
          {headline}
        </Text>
        {subParts.length > 0 && (
          <Text style={[styles.sub, { color: style.fg }]} numberOfLines={1}>
            Shopping list · {subParts.join(' · ')}
          </Text>
        )}
        {subParts.length === 0 && (
          <Text style={[styles.sub, { color: style.fg }]} numberOfLines={1}>
            Tap to open shopping list
          </Text>
        )}
      </View>
      <Icon sf="chevron.right" size={14} color={style.fg} />
    </Pressable>
  );
}

const toneAmber = {
  bg: colors.warningBg,
  border: colors.warningBgStrong,
  fg: colors.warningText,
};

const toneNeutral = {
  bg: colors.primaryTint,
  border: colors.primarySubtle,
  fg: colors.primary,
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    ...shadows.sm,
  },
  body: { flex: 1, gap: 2 },
  headline: { ...typography.subhead, fontWeight: '700' },
  sub: { ...typography.footnote, opacity: 0.85 },
});
