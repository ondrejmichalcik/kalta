// ============================================================================
// Stockr – ListHeader
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
}

export interface ListHeaderProps {
  title: string;
  subtitle?: string;
  /** Optional leading element — usually a back button on stack screens. */
  leading?: ReactNode;
  actions?: ListHeaderAction[];
}

export function ListHeader({ title, subtitle, leading, actions }: ListHeaderProps) {
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
        {actions && actions.length > 0 ? (
          <View style={styles.actions}>
            {actions.map((a, i) => (
              <Pressable
                key={i}
                hitSlop={12}
                onPress={a.onPress}
                accessibilityLabel={a.label}
                style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.5 }]}
              >
                <Icon sf={a.sfIcon} size={22} color={colors.text} />
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
});
