// ============================================================================
// Kalta – PackPickerSheet (Sprint 7+)
// Drop a whole pre-prepared group (FEMA group or household add-on) into a
// checklist at once, instead of adding items one by one. Packs whose items are
// already all present show as "Added". Stays open so several can be added.
// ============================================================================
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KIT_PACKS, type KitAddon } from '@/src/data/emergencyKit';
import { colors, radius, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';

export function PackPickerSheet({
  visible,
  presentSeedKeys,
  onAdd,
  onClose,
}: {
  visible: boolean;
  /** seed_keys already in the checklist — used to mark packs as fully added. */
  presentSeedKeys: Set<string>;
  onAdd: (pack: KitAddon) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <View style={styles.topBarBtn} />
          <Text style={styles.title}>Add from a pack</Text>
          <Pressable hitSlop={12} onPress={onClose} style={styles.topBarBtn}>
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.intro}>
            Drop a whole prepared group into this checklist. Items already on the list are skipped.
          </Text>
          {KIT_PACKS.map((pack) => {
            const allPresent = pack.entries.every((e) => presentSeedKeys.has(e.id));
            return (
              <View key={pack.key} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{pack.label}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {pack.entries.length} {pack.entries.length === 1 ? 'item' : 'items'} ·{' '}
                    {pack.entries.map((e) => e.label).join(', ')}
                  </Text>
                </View>
                {allPresent ? (
                  <View style={styles.addedBadge}>
                    <Icon sf="checkmark" size={12} color={colors.successText} />
                    <Text style={styles.addedText}>Added</Text>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => onAdd(pack)}
                    style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.7 }]}
                  >
                    <Icon sf="plus" size={13} color={colors.primary} />
                    <Text style={styles.addText}>Add</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  topBarBtn: { minWidth: 56, justifyContent: 'center' },
  title: { ...typography.headline, color: colors.text, flex: 1, textAlign: 'center' },
  done: { ...typography.body, color: colors.primary, fontWeight: '700', textAlign: 'right' },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  intro: { ...typography.footnote, color: colors.textMuted, marginBottom: spacing.xs, lineHeight: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  rowLabel: { ...typography.body, color: colors.text, fontWeight: '600' },
  rowSub: { ...typography.footnote, color: colors.textMuted, marginTop: 1 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.primarySubtle,
    backgroundColor: colors.primaryTint,
  },
  addText: { ...typography.footnote, color: colors.primary, fontWeight: '700' },
  addedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
    backgroundColor: colors.successBg,
  },
  addedText: { ...typography.caption, color: colors.successText, fontWeight: '700' },
});
