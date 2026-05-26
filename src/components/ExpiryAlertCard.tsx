// ============================================================================
// Kalta – ExpiryAlertCard
// Banner card surfaced inside the AlertsBell dropdown. Picks the most urgent
// tier present (1d > 30d > 60d) and renders one card so the panel stays
// concise. Tap navigates to the alerts deep link that lists the matching
// items.
// ============================================================================
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, shadows, spacing, typography } from '@/src/theme';
import { Icon } from './Icon';

export type ExpiryTier = 1 | 30 | 60;

interface Counts {
  d1: number;
  d30: number;
  d60: number;
}

interface Props {
  counts: Counts;
  /** Called when the user taps the card. Receives the picked tier so callers
   *  can navigate to the right alerts/[window] route. */
  onPress: (tier: ExpiryTier) => void;
}

/** Helper for bell callers — pick the worst non-zero tier (or null). */
export function pickExpiryTier(counts: Counts): ExpiryTier | null {
  if (counts.d1 > 0) return 1;
  if (counts.d30 > 0) return 30;
  if (counts.d60 > 0) return 60;
  return null;
}

const TIER_STYLE: Record<
  ExpiryTier,
  { bg: string; border: string; fg: string; icon: 'exclamationmark.triangle.fill' | 'bell.fill' | 'clock' }
> = {
  1: {
    bg: colors.dangerBg,
    border: colors.dangerBgStrong,
    fg: colors.dangerText,
    icon: 'exclamationmark.triangle.fill',
  },
  30: {
    bg: colors.warningBg,
    border: colors.warningBgStrong,
    fg: colors.warningText,
    icon: 'bell.fill',
  },
  60: {
    bg: colors.primaryTint,
    border: colors.primarySubtle,
    fg: colors.primary,
    icon: 'clock',
  },
};

function headline(tier: ExpiryTier, count: number): string {
  if (tier === 1) {
    return `${count} ${count === 1 ? 'item expires' : 'items expire'} within a day`;
  }
  if (tier === 30) {
    return `${count} ${count === 1 ? 'item' : 'items'} expiring within 30 days`;
  }
  return `${count} ${count === 1 ? 'item' : 'items'} expiring within 60 days`;
}

export function ExpiryAlertCard({ counts, onPress }: Props) {
  const tier = pickExpiryTier(counts);
  if (tier == null) return null;
  const style = TIER_STYLE[tier];
  const count = tier === 1 ? counts.d1 : tier === 30 ? counts.d30 : counts.d60;

  return (
    <Pressable
      onPress={() => onPress(tier)}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: style.bg, borderColor: style.border },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Icon sf={style.icon} size={20} color={style.fg} />
      <View style={styles.body}>
        <Text style={[styles.headline, { color: style.fg }]} numberOfLines={2}>
          {headline(tier, count)}
        </Text>
        <Text style={[styles.sub, { color: style.fg }]} numberOfLines={1}>
          Tap to see what's expiring
        </Text>
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
  body: { flex: 1, gap: 2 },
  headline: { ...typography.subhead, fontWeight: '700' },
  sub: { ...typography.footnote, opacity: 0.85 },
});
