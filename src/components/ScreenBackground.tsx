// ============================================================================
// Kalta – ScreenBackground
// Wraps screen content in the diagonal sage-green gradient image. Use as the
// outermost element of any screen that should share the brand background.
// ============================================================================
import { ImageBackground, StyleSheet } from 'react-native';
import type { ReactNode } from 'react';
import { colors } from '@/src/theme';

export interface ScreenBackgroundProps {
  children: ReactNode;
}

export function ScreenBackground({ children }: ScreenBackgroundProps) {
  return (
    <ImageBackground
      source={require('@/assets/screen-bg.png')}
      style={styles.bg}
      resizeMode="cover"
    >
      {children}
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
