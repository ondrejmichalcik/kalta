// ============================================================================
// Kalta – Resource icon
// One canonical mapping from a sync resource (table + optional item category)
// to its display icon. Used everywhere a row represents an item / box /
// warehouse so the user can scan a list and immediately see what kind of
// thing each row is.
//
// Items use the brand 3D PNG icons from assets/icons/ that match their
// category. Boxes and warehouses use SF Symbols — they don't have their
// own brand artwork and "house" / "shippingbox" are universally legible.
// ============================================================================
import { Image, View, type StyleProp, type ViewStyle } from 'react-native';
import { SymbolView } from 'expo-symbols';
import type { Category } from '@/src/types/database';
import { colors, radius } from '@/src/theme';

// Tables we recognise. Anything else falls back to a generic tag icon.
export type ResourceTable =
  | 'items'
  | 'boxes'
  | 'warehouses'
  | 'custom_products'
  | 'inventory_sessions'
  | 'inventory_lines';

const CATEGORY_PNG: Record<Category, ReturnType<typeof require>> = {
  food: require('@/assets/icons/food-can.png'),
  medicine: require('@/assets/icons/medicine-pill.png'),
  water: require('@/assets/icons/water-drop.png'),
  disinfectant: require('@/assets/icons/disinfectant-bottle.png'),
  equipment: require('@/assets/icons/tool-wrench.png'),
  energy: require('@/assets/icons/battery.png'),
  documents: require('@/assets/icons/document.png'),
  other: require('@/assets/icons/tag.png'),
};

const FALLBACK_ITEM_PNG = require('@/assets/icons/tag.png');
const CUSTOM_PRODUCT_PNG = require('@/assets/icons/scan-qr.png');

interface Props {
  table: ResourceTable;
  /** For items only — drives which category icon is used. */
  category?: Category | null;
  /**
   * Pixel size of the icon canvas (square). The PNG renders inside this
   * size with a small inset; the SF Symbol fills the canvas.
   */
  size?: number;
  /** Optional background tint behind the icon. Useful for visual grouping. */
  background?: string;
  /**
   * Optional small colored dot rendered in the top-right corner.
   * Use for status indicators like expiry color on item rows.
   */
  statusDotColor?: string;
  style?: StyleProp<ViewStyle>;
}

export function ResourceIcon({
  table,
  category,
  size = 32,
  background,
  statusDotColor,
  style,
}: Props) {
  // When the caller wants a status dot in the corner we render the icon
  // inside a positioned wrapper so the dot can overlap the icon's edge.
  // Otherwise we render the icon container directly (less DOM).
  if (statusDotColor) {
    return (
      <View style={[{ width: size, height: size }, style]}>
        <ResourceIcon
          table={table}
          category={category}
          size={size}
          background={background}
        />
        <ResourceStatusDot color={statusDotColor} iconSize={size} />
      </View>
    );
  }

  const containerStyle: StyleProp<ViewStyle> = [
    {
      width: size,
      height: size,
      borderRadius: size * 0.25,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: background ?? 'transparent',
      overflow: 'hidden',
    },
    style,
  ];

  if (table === 'boxes') {
    return (
      <View style={containerStyle}>
        <SymbolView
          name="shippingbox.fill"
          size={size * 0.7}
          tintColor={colors.primary}
        />
      </View>
    );
  }

  if (table === 'warehouses') {
    return (
      <View style={containerStyle}>
        <SymbolView
          name="house.fill"
          size={size * 0.7}
          tintColor={colors.primary}
        />
      </View>
    );
  }

  if (table === 'inventory_sessions' || table === 'inventory_lines') {
    return (
      <View style={containerStyle}>
        <SymbolView
          name="checklist"
          size={size * 0.7}
          tintColor={colors.primary}
        />
      </View>
    );
  }

  if (table === 'custom_products') {
    return (
      <View style={containerStyle}>
        <Image
          source={CUSTOM_PRODUCT_PNG}
          style={{ width: size * 0.85, height: size * 0.85 }}
          resizeMode="contain"
        />
      </View>
    );
  }

  // table === 'items'
  const png = (category && CATEGORY_PNG[category]) ?? FALLBACK_ITEM_PNG;
  return (
    <View style={containerStyle}>
      <Image
        source={png}
        style={{ width: size * 0.92, height: size * 0.92 }}
        resizeMode="contain"
      />
    </View>
  );
}

interface OpBadgeProps {
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  /** Outer container size — the icon to which the badge is anchored. */
  iconSize?: number;
}

/**
 * Small operation badge (plus / pencil / minus) that overlays the
 * top-right corner of a ResourceIcon. Combine inside a relative-positioned
 * wrapper:
 *
 *   <View style={{ width: 32, height: 32 }}>
 *     <ResourceIcon ... />
 *     <ResourceOpBadge operation="UPDATE" iconSize={32} />
 *   </View>
 */
export function ResourceOpBadge({ operation, iconSize = 32 }: OpBadgeProps) {
  const meta = OP_META[operation];
  const badgeSize = Math.max(14, Math.round(iconSize * 0.5));
  const offset = -Math.round(badgeSize * 0.25);
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: offset,
        right: offset,
        width: badgeSize,
        height: badgeSize,
        borderRadius: badgeSize / 2,
        backgroundColor: meta.bg,
        borderWidth: 2,
        borderColor: colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <SymbolView
        name={meta.symbol as any}
        size={Math.round(badgeSize * 0.6)}
        tintColor="#ffffff"
      />
    </View>
  );
}

const OP_META: Record<
  'INSERT' | 'UPDATE' | 'DELETE',
  { symbol: string; bg: string }
> = {
  INSERT: { symbol: 'plus', bg: colors.success },
  UPDATE: { symbol: 'pencil', bg: colors.palette.blue[500] },
  DELETE: { symbol: 'minus', bg: colors.warningText },
};

interface StatusDotProps {
  color: string;
  iconSize?: number;
}

/**
 * Tiny colored dot rendered in the top-right corner of a ResourceIcon.
 * Used for expiry status indicators on item rows so the user can scan a
 * list and see urgency without a separate dot column. Same anchoring as
 * ResourceOpBadge, smaller size (no internal symbol).
 */
function ResourceStatusDot({ color, iconSize = 32 }: StatusDotProps) {
  const dotSize = Math.max(10, Math.round(iconSize * 0.32));
  const offset = -Math.round(dotSize * 0.2);
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: offset,
        right: offset,
        width: dotSize,
        height: dotSize,
        borderRadius: dotSize / 2,
        backgroundColor: color,
        borderWidth: 2,
        borderColor: colors.surface,
      }}
    />
  );
}

/**
 * Convenience: render a ResourceIcon with an operation badge in one go,
 * using a relatively positioned wrapper that sizes itself correctly.
 */
export function ResourceIconWithOp({
  table,
  category,
  operation,
  size = 32,
  background,
}: Props & { operation: 'INSERT' | 'UPDATE' | 'DELETE' }) {
  return (
    <View style={{ width: size, height: size }}>
      <ResourceIcon
        table={table}
        category={category}
        size={size}
        background={background ?? colors.primaryTint}
        style={{ borderRadius: radius.md }}
      />
      <ResourceOpBadge operation={operation} iconSize={size} />
    </View>
  );
}
