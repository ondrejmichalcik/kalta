import type { ViewStyle } from 'react-native';

// iOS shadow presets tuned for light-mode cards. Opacities are higher than
// the usual "subtle" values because Kalta's background is near-white and
// needs visible lift for pill cards. `elevation` is Android-only and inert
// on iOS but kept for parity.
export const shadows = {
  none: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  sm: {
    shadowColor: '#0B1F12',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  md: {
    shadowColor: '#0B1F12',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  lg: {
    shadowColor: '#0B1F12',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 6,
  },
} as const satisfies Record<string, ViewStyle>;

export type Shadows = typeof shadows;
