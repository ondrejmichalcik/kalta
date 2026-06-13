// ============================================================================
// Kalta – Icon
// Unified icon component with two namespaces:
//
//   <Icon sf="magnifyingglass" size={20} color={colors.text} />
//       → SF Symbol via expo-symbols. Use for ALL utility chrome icons:
//         nav, buttons, list rows, tab bar, form fields, category indicators.
//
//   <Icon brand="box-generic" size={96} />
//       → Pre-rendered 3D sage-green PNG from assets/icons/. Use ONLY for
//         hero moments: login/splash, large empty-state illustrations.
//
// Exactly one of `sf` / `brand` must be provided.
// ============================================================================
import { Image } from 'react-native';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ImageStyle, StyleProp, ViewStyle } from 'react-native';

// Brand PNG registry — 3D rendered sage green icons for hero moments only.
// Most entries are dormant after Sprint 2.6; kept for future onboarding /
// marketing screens and current empty-state illustrations.
const BRAND_ICONS = {
  'chevron-left': require('@/assets/icons/chevron-left.png'),
  'chevron-right': require('@/assets/icons/chevron-right.png'),
  'chevron-down': require('@/assets/icons/chevron-down.png'),
  'chevron-up': require('@/assets/icons/chevron-up.png'),
  'close': require('@/assets/icons/close.png'),
  'more': require('@/assets/icons/more.png'),
  'plus': require('@/assets/icons/plus.png'),
  'check': require('@/assets/icons/check.png'),
  'edit': require('@/assets/icons/edit.png'),
  'trash': require('@/assets/icons/trash.png'),
  'copy': require('@/assets/icons/copy.png'),
  'share': require('@/assets/icons/share.png'),
  'printer': require('@/assets/icons/printer.png'),
  'retry': require('@/assets/icons/retry.png'),
  'camera': require('@/assets/icons/camera.png'),
  'flashlight-on': require('@/assets/icons/flashlight-on.png'),
  'flashlight-off': require('@/assets/icons/flashlight-off.png'),
  'scan-qr': require('@/assets/icons/scan-qr.png'),
  'grid': require('@/assets/icons/grid.png'),
  'list': require('@/assets/icons/list.png'),
  'pin': require('@/assets/icons/pin.png'),
  'warning': require('@/assets/icons/warning.png'),
  'inbox': require('@/assets/icons/inbox.png'),
  'tag': require('@/assets/icons/tag.png'),
  'food-can': require('@/assets/icons/food-can.png'),
  'medicine-pill': require('@/assets/icons/medicine-pill.png'),
  'water-drop': require('@/assets/icons/water-drop.png'),
  'disinfectant-bottle': require('@/assets/icons/disinfectant-bottle.png'),
  'tool-wrench': require('@/assets/icons/tool-wrench.png'),
  'battery': require('@/assets/icons/battery.png'),
  'document': require('@/assets/icons/document.png'),
  'box-generic': require('@/assets/icons/box-generic.png'),
} as const;

export type BrandIconName = keyof typeof BRAND_ICONS;

// SF Symbols are typed as string by expo-symbols — we keep it wide open.
// See https://developer.apple.com/sf-symbols/ for available names.
export type SFSymbolName = NonNullable<SymbolViewProps['name']>;

// Exactly one of `sf` / `brand` is provided (loose typing, not a discriminated
// union, to keep call sites simple).
export interface IconProps {
  /** SF Symbol name (preferred for utility chrome — buttons, nav, lists) */
  sf?: SFSymbolName;
  /** Brand 3D PNG name (hero moments only — login/splash/empty states) */
  brand?: BrandIconName;
  size?: number;
  color?: string;
  weight?: SymbolViewProps['weight'];
  scale?: SymbolViewProps['scale'];
  style?: StyleProp<ViewStyle | ImageStyle>;
}

export function Icon({
  sf,
  brand,
  size = 24,
  color,
  weight,
  scale,
  style,
}: IconProps) {
  if (sf) {
    return (
      <SymbolView
        name={sf}
        size={size}
        tintColor={color}
        weight={weight}
        scale={scale}
        resizeMode="scaleAspectFit"
        style={[{ width: size, height: size }, style as StyleProp<ViewStyle>]}
      />
    );
  }

  if (brand) {
    return (
      <Image
        source={BRAND_ICONS[brand]}
        style={[{ width: size, height: size }, style as StyleProp<ImageStyle>]}
        resizeMode="contain"
      />
    );
  }

  return null;
}
