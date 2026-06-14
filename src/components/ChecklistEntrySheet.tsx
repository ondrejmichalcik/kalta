// ============================================================================
// Kalta – ChecklistEntrySheet (Sprint 7)
// Add / edit a checklist entry: label, group, category, quantified (food/water
// → coverage-by-days), match keywords, rationale. Replaces the label-only and
// keywords-only Alert.prompt flows with one proper editor.
// ============================================================================
import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createChecklistEntry, updateChecklistEntry } from '@/src/lib/supabase';
import { toast } from '@/src/lib/feedback';
import {
  CATEGORIES,
  CATEGORY_LABEL,
  type Category,
  type ChecklistEntry,
} from '@/src/types/database';
import { colors, radius, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';

type Quantified = 'food' | 'water' | null;

export function ChecklistEntrySheet({
  visible,
  entry,
  checklistId,
  warehouseId,
  sortOrder,
  onClose,
  onSaved,
}: {
  visible: boolean;
  /** null → create a new entry; otherwise edit this one. */
  entry: ChecklistEntry | null;
  checklistId: string;
  warehouseId: string;
  /** sort_order to assign when creating (appended at the end). */
  sortOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState('');
  const [group, setGroup] = useState('Custom');
  const [category, setCategory] = useState<Category | null>(null);
  const [quantified, setQuantified] = useState<Quantified>(null);
  const [keywords, setKeywords] = useState('');
  const [rationale, setRationale] = useState('');
  const [saving, setSaving] = useState(false);

  // Re-seed the form whenever the sheet opens for a different entry.
  useEffect(() => {
    if (!visible) return;
    setLabel(entry?.label ?? '');
    setGroup(entry?.group_name ?? 'Custom');
    setCategory(entry?.category ?? null);
    setQuantified(entry?.quantified ?? null);
    setKeywords(entry?.keywords.join(', ') ?? '');
    setRationale(entry?.rationale ?? '');
    setSaving(false);
  }, [visible, entry]);

  const save = async () => {
    const trimmed = label.trim();
    if (!trimmed) {
      toast.info('Give the checklist item a name.');
      return;
    }
    const kws = keywords
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    setSaving(true);
    try {
      if (entry) {
        await updateChecklistEntry(entry.id, {
          label: trimmed,
          group_name: group.trim() || 'Custom',
          category,
          quantified,
          keywords: kws,
          rationale: rationale.trim() || null,
        });
      } else {
        await createChecklistEntry({
          checklist_id: checklistId,
          warehouse_id: warehouseId,
          label: trimmed,
          group_name: group.trim() || 'Custom',
          category,
          quantified,
          keywords: kws,
          rationale: rationale.trim() || null,
          sort_order: sortOrder,
        });
      }
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <Pressable hitSlop={12} onPress={onClose} style={styles.topBarBtn}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {entry ? 'Edit item' : 'New item'}
          </Text>
          <Pressable hitSlop={12} onPress={save} disabled={saving} style={styles.topBarBtn}>
            <Text style={[styles.save, saving && { opacity: 0.4 }]}>Save</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.fieldLabel}>LABEL</Text>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="e.g. Dog food"
            placeholderTextColor={colors.textSubtle}
            style={styles.input}
            autoFocus={!entry}
          />

          <Text style={styles.fieldLabel}>GROUP</Text>
          <TextInput
            value={group}
            onChangeText={setGroup}
            placeholder="Custom"
            placeholderTextColor={colors.textSubtle}
            style={styles.input}
          />

          <Text style={styles.fieldLabel}>CATEGORY</Text>
          <View style={styles.chipWrap}>
            <Chip label="None" active={category == null} onPress={() => setCategory(null)} />
            {CATEGORIES.map((c) => (
              <Chip
                key={c}
                label={CATEGORY_LABEL[c]}
                active={category === c}
                onPress={() => setCategory(c)}
              />
            ))}
          </View>

          <Text style={styles.fieldLabel}>COVERAGE BY DAYS</Text>
          <Text style={styles.hint}>
            Set Food/Water to measure this item against your survival-days goal instead of a
            plain have/don&apos;t-have check.
          </Text>
          <View style={styles.chipWrap}>
            <Chip label="No" active={quantified == null} onPress={() => setQuantified(null)} />
            <Chip label="Food" active={quantified === 'food'} onPress={() => setQuantified('food')} />
            <Chip label="Water" active={quantified === 'water'} onPress={() => setQuantified('water')} />
          </View>

          <Text style={styles.fieldLabel}>MATCH KEYWORDS</Text>
          <Text style={styles.hint}>
            Comma-separated. End a word with * for a stem match (e.g. lék*). Leave empty to rely
            on manual pinning.
          </Text>
          <TextInput
            value={keywords}
            onChangeText={setKeywords}
            placeholder="dog food, krmivo, pedigree"
            placeholderTextColor={colors.textSubtle}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.fieldLabel}>WHY (optional)</Text>
          <TextInput
            value={rationale}
            onChangeText={setRationale}
            placeholder="Short reason this matters"
            placeholderTextColor={colors.textSubtle}
            style={[styles.input, styles.multiline]}
            multiline
          />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active ? styles.chipActive : styles.chipInactive,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.chipText, { color: active ? colors.textOnPrimary : colors.text }]}>
        {label}
      </Text>
    </Pressable>
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
  topBarBtn: { minWidth: 60, justifyContent: 'center' },
  title: { ...typography.headline, color: colors.text, flex: 1, textAlign: 'center' },
  cancel: { ...typography.body, color: colors.textMuted },
  save: { ...typography.body, color: colors.primary, fontWeight: '700', textAlign: 'right' },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xs },
  fieldLabel: { ...typography.label, color: colors.textMuted, marginTop: spacing.md },
  hint: { ...typography.footnote, color: colors.textMuted, marginBottom: spacing.xs, lineHeight: 17 },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  multiline: { minHeight: 60, textAlignVertical: 'top' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2 },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipInactive: { backgroundColor: colors.surface, borderColor: colors.border },
  chipText: { ...typography.footnote, fontWeight: '600' },
});
