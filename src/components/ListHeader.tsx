// ============================================================================
// Kalta – ListHeader
// Large title + optional trailing action icons (search, filter, sort, ...).
// Used at the top of list screens (Boxes tab, Items tab, Box detail).
// ============================================================================
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReactNode } from 'react';
import { colors, spacing, typography } from '@/src/theme';
import { Icon } from './Icon';
import type { SFSymbolName } from './Icon';

export interface ListHeaderAction {
  sfIcon: SFSymbolName;
  onPress: () => void;
  /** Accessibility hint for VoiceOver. */
  label?: string;
  /** Small number badge in the top-right of the icon (e.g. active filter count). */
  badge?: number;
  /** Tint the icon with the primary color to signal "active". */
  active?: boolean;
}

export interface ListHeaderProps {
  title: string;
  subtitle?: string;
  /** Optional leading element — usually a back button on stack screens. */
  leading?: ReactNode;
  actions?: ListHeaderAction[];
  /** Custom element rendered to the left of the SF-icon actions. Use for
   *  things the standard ListHeaderAction can't express (e.g. a bell with a
   *  colored dot overlay). */
  trailing?: ReactNode;
}

export function ListHeader({ title, subtitle, leading, actions, trailing }: ListHeaderProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {leading ? <View style={styles.leading}>{leading}</View> : null}
        <View style={styles.titleBlock}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {trailing || (actions && actions.length > 0) ? (
          <View style={styles.actions}>
            {trailing}
            {actions?.map((a, i) => (
              <Pressable
                key={i}
                hitSlop={12}
                onPress={a.onPress}
                accessibilityLabel={a.label}
                style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.5 }]}
              >
                <Icon sf={a.sfIcon} size={22} color={a.active ? colors.primary : colors.text} />
                {a.badge && a.badge > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{a.badge}</Text>
                  </View>
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  leading: {
    marginRight: spacing.xs,
  },
  titleBlock: {
    flex: 1,
  },
  title: {
    ...typography.largeTitle,
    fontSize: 32,
    lineHeight: 38,
    color: colors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    ...typography.footnote,
    color: colors.textMuted,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actionBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: colors.textOnPrimary,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
});
