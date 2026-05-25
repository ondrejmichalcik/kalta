// ============================================================================
// Kalta – Category picker (bottom sheet)
// Modal sheet listing every Category with its icon. Used by ItemEditSheet
// and add-items to replace the horizontally scrolling chip row, which made
// it easy to miss categories that were off-screen.
// ============================================================================
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  CATEGORIES,
  CATEGORY_LABEL,
  type Category,
} from '@/src/types/database';
import { colors, radius, spacing, typography } from '@/src/theme';
import { Icon } from './Icon';
import { ResourceIcon } from './ResourceIcon';

interface Props {
  visible: boolean;
  value: Category | null;
  /** When true, an extra "No category" row at the top lets the user clear. */
  allowNull?: boolean;
  onSelect: (value: Category | null) => void;
  onClose: () => void;
}

export function CategoryPickerSheet({
  visible,
  value,
  allowNull = true,
  onSelect,
  onClose,
}: Props) {
  const handlePick = (next: Category | null) => {
    Haptics.selectionAsync().catch(() => {});
    onSelect(next);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <View style={styles.grabberWrap}>
          <View style={styles.grabber} />
        </View>
        <View style={styles.header}>
          <Text style={styles.title}>Category</Text>
          <Pressable hitSlop={12} onPress={onClose}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.list}>
          {allowNull && (
            <Pressable
              onPress={() => handlePick(null)}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <View style={styles.iconPlaceholder}>
                <Icon sf="minus.circle" size={20} color={colors.textMuted} />
              </View>
              <Text style={styles.label}>No category</Text>
              {value === null && (
                <Icon sf="checkmark" size={18} color={colors.primary} />
              )}
            </Pressable>
          )}
          {CATEGORIES.map((c) => {
            const active = value === c;
            return (
              <Pressable
                key={c}
                onPress={() => handlePick(c)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <ResourceIcon table="items" category={c} size={32} />
                <Text style={styles.label}>{CATEGORY_LABEL[c]}</Text>
                {active && (
                  <Icon sf="checkmark" size={18} color={colors.primary} />
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Trigger row — drop-in replacement for the previous category chip row.
// Renders the current selection (or a "Pick category" placeholder) as a
// tappable list row that opens the picker sheet.

interface TriggerProps {
  value: Category | null;
  onPress: () => void;
}

export function CategoryPickerTrigger({ value, onPress }: TriggerProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.trigger, pressed && { opacity: 0.7 }]}
    >
      {value ? (
        <ResourceIcon table="items" category={value} size={28} />
      ) : (
        <View style={styles.triggerIconPlaceholder}>
          <Icon sf="tag" size={16} color={colors.textMuted} />
        </View>
      )}
      <Text style={[styles.triggerLabel, !value && styles.triggerLabelPlaceholder]}>
        {value ? CATEGORY_LABEL[value] : 'Pick a category'}
      </Text>
      <Icon sf="chevron.up.chevron.down" size={14} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '80%',
  },
  grabberWrap: { alignItems: 'center', paddingTop: spacing.sm },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.palette.neutral[300],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: { ...typography.headline, color: colors.text },
  cancel: { ...typography.body, color: colors.primary, fontWeight: '600' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  rowPressed: { backgroundColor: colors.palette.neutral[100] },
  iconPlaceholder: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { ...typography.body, color: colors.text, flex: 1 },
  // Trigger
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  triggerIconPlaceholder: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  triggerLabel: { ...typography.body, color: colors.text, flex: 1 },
  triggerLabelPlaceholder: { color: colors.textSubtle },
});
