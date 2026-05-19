// ============================================================================
// Kalta – StatusDot
// Small colored circle used as the leading indicator on list cards to signal
// expiry status at a glance. Mirrors NoWaste's card layout.
// ============================================================================
import { StyleSheet, View } from 'react-native';
import { colors } from '@/src/theme';
import type { ExpiryStatus } from '@/src/types/database';

export interface StatusDotProps {
  status: ExpiryStatus;
  size?: number;
}

const STATUS_COLOR: Record<ExpiryStatus, string> = {
  expired: colors.danger,
  critical: colors.danger,
  soon: colors.warning,
  ok: colors.success,
  none: colors.borderStrong,
  never: colors.textSubtle,
};

export function StatusDot({ status, size = 10 }: StatusDotProps) {
  return (
    <View
      style={[
        styles.dot,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: STATUS_COLOR[status],
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {
    flexShrink: 0,
  },
});
