// Light-first palette for Stockr utility screens. The login/splash hero is
// the only dark surface — `hero*` tokens are kept for it. All other screens
// use the light tokens exposed directly on `colors`.

// Sage green scale — sampled from the app icon's radial gradient. Still the
// brand color, just used as an accent on light surfaces instead of a full
// background fill.
const sage = {
  50: '#F0F7F3',
  100: '#DCEBE2',
  200: '#BDD8C7',
  300: '#8FB9A0',
  400: '#5C9678',
  500: '#2E7A52',
  600: '#1E5F3E',
  700: '#174D32',
  800: '#103927',
  900: '#0A2519',
} as const;

// Cool neutrals with a slight green tint so near-white surfaces feel brand-y
// without being obviously colored.
const neutral = {
  0: '#FFFFFF',
  50: '#F4F7F4',
  100: '#EDF1EE',
  200: '#E0E5E1',
  300: '#C5CCC7',
  400: '#9AA29D',
  500: '#6B7370',
  600: '#4C534F',
  700: '#343835',
  800: '#1E211F',
  900: '#0F1110',
} as const;

// Status palettes — full-saturation iOS-like values. These will read well on
// the near-white background.
const red = {
  50: '#FEF2F2',
  100: '#FEE2E2',
  200: '#FBC9C9',
  500: '#DC2626',
  600: '#B91C1C',
  700: '#991B1B',
} as const;

const amber = {
  50: '#FFFBEB',
  100: '#FEF3C7',
  200: '#FDE68A',
  500: '#D97706',
  600: '#B45309',
  700: '#92400E',
} as const;

const blue = {
  50: '#EFF6FF',
  100: '#DBEAFE',
  500: '#2563EB',
  600: '#1D4ED8',
  700: '#1E40AF',
} as const;

// Semantic tokens. Use these in screens, not the raw palettes above.
export const colors = {
  // Brand
  primary: sage[500],
  primaryDark: sage[600],
  primaryLight: sage[400],
  primarySubtle: sage[100],
  primaryTint: sage[50],

  // Surfaces
  background: neutral[50],
  surface: neutral[0],
  surfaceElevated: neutral[0],
  surfaceInverted: neutral[800],

  // Hero tokens — login/splash only. Kept from Sprint 2.5 so the dark hero
  // pattern stays available for brand moments.
  heroBackground: sage[800],
  heroSurface: 'rgba(255, 255, 255, 0.10)',
  heroBorder: 'rgba(255, 255, 255, 0.18)',
  heroText: '#FFFFFF',
  heroTextMuted: 'rgba(255, 255, 255, 0.72)',
  heroTextSubtle: 'rgba(255, 255, 255, 0.45)',

  // Text
  text: neutral[800],
  textMuted: neutral[500],
  textSubtle: neutral[400],
  textOnPrimary: '#FFFFFF',
  textOnDanger: '#FFFFFF',
  textInverted: '#FFFFFF',

  // Borders
  border: neutral[200],
  borderStrong: neutral[300],
  borderFocus: sage[500],

  // Status — full saturation for readable badges on light background
  danger: red[500],
  dangerDark: red[600],
  dangerBg: red[50],
  dangerBgStrong: red[100],
  dangerText: red[700],

  warning: amber[500],
  warningDark: amber[600],
  warningBg: amber[50],
  warningBgStrong: amber[100],
  warningText: amber[700],

  success: sage[500],
  successDark: sage[600],
  successBg: sage[50],
  successBgStrong: sage[100],
  successText: sage[700],

  info: blue[500],
  infoBg: blue[50],
  infoText: blue[700],

  // Expiry state tokens — pastel tints on light bg
  expiryExpiredBg: red[100],
  expiryCriticalBg: red[50],
  expirySoonBg: amber[50],
  expiryOkBg: sage[50],
  expiryNoneBg: neutral[100],

  // Expiry state tokens — text / icon tint (high contrast on the tint bg)
  expiryExpiredText: red[700],
  expiryCriticalText: red[600],
  expirySoonText: amber[700],
  expiryOkText: sage[700],
  expiryNoneText: neutral[500],

  // Utility
  overlay: 'rgba(15, 17, 16, 0.45)',
  scrim: 'rgba(15, 17, 16, 0.65)',
  transparent: 'transparent',

  // Raw palettes re-exported for rare escape-hatch usage
  palette: { sage, neutral, red, amber, blue },
} as const;

export type Colors = typeof colors;
