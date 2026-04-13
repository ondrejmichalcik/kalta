// ============================================================================
// Stockr – Floating Action Button (pill style)
// A rounded sage-green pill button that floats above the tab bar. Each screen
// decides its own primary action by rendering <FAB /> (usually inside the
// screen's SafeAreaView but positioned absolutely).
// ============================================================================
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors, radius, shadows, spacing, typography } from '@/src/theme';
import { Icon } from './Icon';
import type { SFSymbolName } from './Icon';

export interface FABProps {
  label: string;
  sfIcon?: SFSymbolName;
  onPress: () => void;
  /** Distance from the bottom safe area. Default pairs with the tab bar. */
  bottom?: number;
  style?: StyleProp<ViewStyle>;
}

export function FAB({ label, sfIcon, onPress, bottom = 24, style }: FABProps) {
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom }, style]}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
      >
        {sfIcon ? <Icon sf={sfIcon} size={18} color={colors.textOnPrimary} /> : null}
        <Text style={styles.label}>{label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.full,
    ...shadows.lg,
  },
  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  label: {
    ...typography.bodyStrong,
    color: colors.textOnPrimary,
  },
});
