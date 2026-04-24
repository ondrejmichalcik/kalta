// ============================================================================
// Kalta – BoxPicker modal
// Reusable picker that lists all boxes in a warehouse. Used by the "Move
// to another box" flow in ItemEditSheet and the multi-select batch move
// in box detail.
// ============================================================================
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listBoxes } from '@/src/lib/supabase';
import type { Box } from '@/src/types/database';
import { colors, radius, spacing, typography } from '@/src/theme';
import { Icon } from './Icon';
import { Card } from './Card';

export interface BoxPickerProps {
  warehouseId: string;
  /** Box to exclude from the list (the box the items are currently in). */
  excludeBoxId?: string;
  onSelect: (box: Box) => void;
  onClose: () => void;
}

export function BoxPicker({
  warehouseId,
  excludeBoxId,
  onSelect,
  onClose,
}: BoxPickerProps) {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listBoxes(warehouseId)
      .then((rows) => {
        setBoxes(excludeBoxId ? rows.filter((b) => b.id !== excludeBoxId) : rows);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [warehouseId, excludeBoxId]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>Move to box</Text>
        <Pressable hitSlop={12} onPress={onClose}>
          <Text style={styles.close}>Cancel</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : boxes.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No other boxes in this warehouse.</Text>
        </View>
      ) : (
        <FlatList
          data={boxes}
          keyExtractor={(b) => b.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Card onPress={() => onSelect(item)} style={styles.card}>
              <Icon sf="shippingbox.fill" size={20} color={colors.primary} />
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.location ? (
                  <Text style={styles.cardSubtitle} numberOfLines={1}>
                    {item.location}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.cardCount}>
                {item.item_count} {item.item_count === 1 ? 'item' : 'items'}
              </Text>
              <Icon sf="chevron.right" size={14} color={colors.textSubtle} />
            </Card>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: {
    ...typography.headline,
    color: colors.text,
  },
  close: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
  },
  emptyText: {
    ...typography.subhead,
    color: colors.textMuted,
    textAlign: 'center',
  },
  list: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  card: {
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md + 2,
  },
  cardBody: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    ...typography.headline,
    color: colors.text,
  },
  cardSubtitle: {
    ...typography.footnote,
    color: colors.textMuted,
  },
  cardCount: {
    ...typography.footnote,
    color: colors.textMuted,
  },
});
