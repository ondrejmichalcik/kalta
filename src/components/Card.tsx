// ============================================================================
// Kalta – Card
// Opaque pill-style card used for list rows, cards in grids, form sections.
// Replaces the frosted-glass rgba(white) surfaces from Sprint 2.5.
// ============================================================================
import { Pressable, StyleSheet, View } from 'react-native';
import type { PressableProps, StyleProp, ViewStyle } from 'react-native';
import type { ReactNode } from 'react';
import { colors, radius, shadows, spacing } from '@/src/theme';

export interface CardProps extends Omit<PressableProps, 'style' | 'children'> {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** Horizontal flex layout with items centered vertically. Default: true. */
  row?: boolean;
}

export function Card({ children, onPress, style, row = true, ...rest }: CardProps) {
  const content = (
    <View style={[styles.base, row && styles.row, style]}>{children}</View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.pressed]}
      {...rest}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    ...shadows.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
});
