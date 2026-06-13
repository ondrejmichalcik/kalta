// ============================================================================
// Kalta – ReadinessCard (Sprint 6)
// Glanceable banner on the Boxes dashboard. Headline = weakest link days,
// colored by progress toward the warehouse's readiness goal. Tap → detail.
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  getWarehouseById,
  listAllItemsInWarehouse,
  listHouseholdMembers,
  subscribeChecklists,
  subscribeHousehold,
} from '@/src/lib/supabase';
import { computeReadiness, type ReadinessResult } from '@/src/lib/readiness';
import { warehouseTracksSupplies } from '@/src/lib/checklists';
import { colors, radius, shadows, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';
import type { SFSymbolName } from '@/src/components/Icon';

type Tone = 'red' | 'amber' | 'green';

const TONE_STYLE: Record<
  Tone,
  { bg: string; border: string; fg: string; icon: SFSymbolName }
> = {
  red: {
    bg: colors.dangerBg,
    border: colors.dangerBgStrong,
    fg: colors.dangerText,
    icon: 'exclamationmark.triangle.fill',
  },
  amber: {
    bg: colors.warningBg,
    border: colors.warningBgStrong,
    fg: colors.warningText,
    icon: 'exclamationmark.circle.fill',
  },
  green: {
    bg: colors.successBg,
    border: colors.successBgStrong,
    fg: colors.successText,
    icon: 'shield.lefthalf.filled',
  },
};

function formatDays(days: number): string {
  if (days < 1) return '<1 day';
  const d = Math.floor(days);
  return `${d} ${d === 1 ? 'day' : 'days'}`;
}

export function ReadinessCard({
  warehouseId,
  onPress,
}: {
  warehouseId: string;
  /** Override the default tap-to-readiness navigation (used by callers that
   *  embed the card inside a modal and need to close it first). */
  onPress?: () => void;
}) {
  const router = useRouter();
  const [result, setResult] = useState<ReadinessResult | null>(null);
  const [goalDays, setGoalDays] = useState(14);
  const [tracks, setTracks] = useState(true);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!warehouseId) return;
    try {
      const [items, members, wh, tracksSupplies] = await Promise.all([
        listAllItemsInWarehouse(warehouseId),
        listHouseholdMembers(warehouseId),
        getWarehouseById(warehouseId),
        warehouseTracksSupplies(warehouseId).catch(() => true),
      ]);
      setGoalDays(wh?.readiness_goal_days ?? 14);
      setResult(computeReadiness(items, members));
      setTracks(tracksSupplies);
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

  // Live-update when a peer edits household members or checklists.
  useEffect(() => {
    if (!warehouseId) return;
    const unsubHh = subscribeHousehold(warehouseId, () => load());
    const unsubKit = subscribeChecklists(warehouseId, () => load());
    return () => {
      unsubHh();
      unsubKit();
    };
  }, [warehouseId, load]);

  // Nothing to show until first load completes.
  if (!loaded || !result) return null;
  // Warehouse's active checklists aren't supply-oriented (e.g. a workshop) →
  // survival days are irrelevant here, hide the card entirely.
  if (!tracks) return null;

  const goTo =
    onPress ?? (() => router.push(`/warehouse/${warehouseId}/readiness` as any));

  // No household configured → prompt to set one up.
  if (result.weakestLink == null) {
    return (
      <Pressable
        onPress={goTo}
        style={({ pressed }) => [styles.card, styles.neutral, pressed && { opacity: 0.7 }]}
      >
        <Icon sf="person.2.fill" size={20} color={colors.textMuted} />
        <View style={styles.body}>
          <Text style={styles.neutralTitle}>Set up readiness</Text>
          <Text style={styles.neutralSub}>Add household members to track survival days</Text>
        </View>
        <Icon sf="chevron.right" size={14} color={colors.textSubtle} />
      </Pressable>
    );
  }

  const { weakestLink, foodDays, waterDays } = result;
  const ratio = goalDays > 0 ? weakestLink.days / goalDays : 0;
  const tone: Tone = ratio >= 1 ? 'green' : ratio >= 0.25 ? 'amber' : 'red';
  const style = TONE_STYLE[tone];

  const headline =
    tone === 'green'
      ? `${formatDays(weakestLink.days)} ready`
      : `${formatDays(weakestLink.days)} — ${weakestLink.category === 'water' ? 'water' : 'food'} running low`;

  const breakdownParts: string[] = [];
  if (foodDays != null) breakdownParts.push(`Food ${formatDays(foodDays)}`);
  if (waterDays != null) breakdownParts.push(`Water ${formatDays(waterDays)}`);
  const breakdown = breakdownParts.join(' · ');

  return (
    <Pressable
      onPress={goTo}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: style.bg, borderColor: style.border },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Icon sf={style.icon} size={22} color={style.fg} />
      <View style={styles.body}>
        <Text style={[styles.headline, { color: style.fg }]} numberOfLines={1}>
          {headline}
        </Text>
        {!!breakdown && (
          <Text style={[styles.sub, { color: style.fg }]} numberOfLines={1}>
            {breakdown}
            {result.uncountedItems > 0 ? ` · ${result.uncountedItems} not counted` : ''}
          </Text>
        )}
      </View>
      <Icon sf="chevron.right" size={14} color={style.fg} />
    </Pressable>
  );
}

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
  neutral: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  body: { flex: 1, gap: 2 },
  headline: {
    ...typography.subhead,
    fontWeight: '700',
  },
  sub: {
    ...typography.footnote,
    opacity: 0.85,
  },
  neutralTitle: {
    ...typography.subhead,
    color: colors.text,
    fontWeight: '700',
  },
  neutralSub: {
    ...typography.footnote,
    color: colors.textMuted,
  },
});
