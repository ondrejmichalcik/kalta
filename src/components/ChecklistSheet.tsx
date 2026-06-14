// ============================================================================
// Kalta – ChecklistSheet (Sprint 7)
// Create or rename a checklist via a proper page-sheet modal (consistent with
// ItemEditSheet / ChecklistEntrySheet) instead of an Alert.prompt. In create
// mode it also offers "Start from": blank or a copy of an existing list.
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
import { createChecklist, updateChecklist } from '@/src/lib/supabase';
import { toast } from '@/src/lib/feedback';
import { cloneChecklist } from '@/src/lib/checklists';
import type { Checklist } from '@/src/types/database';
import { colors, radius, spacing, typography } from '@/src/theme';

export function ChecklistSheet({
  visible,
  mode,
  warehouseId,
  checklist,
  sources = [],
  onClose,
  onCreated,
  onRenamed,
}: {
  visible: boolean;
  mode: 'create' | 'rename';
  warehouseId: string;
  /** The checklist being renamed (rename mode). */
  checklist?: { id: string; name: string } | null;
  /** Existing checklists offered as "copy from" sources (create mode). */
  sources?: Checklist[];
  onClose: () => void;
  onCreated?: (id: string) => void;
  onRenamed?: (name: string) => void;
}) {
  const [name, setName] = useState('');
  // null = blank; otherwise the source checklist id to copy from.
  const [copyFrom, setCopyFrom] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(mode === 'rename' ? (checklist?.name ?? '') : '');
    setCopyFrom(null);
    setSaving(false);
  }, [visible, mode, checklist]);

  const pickSource = (id: string | null) => {
    setCopyFrom(id);
    // Prefill a sensible name when copying and the field is still empty.
    if (id && !name.trim()) {
      const src = sources.find((s) => s.id === id);
      if (src) setName(`${src.name} copy`);
    }
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.info('Give the checklist a name.');
      return;
    }
    setSaving(true);
    try {
      if (mode === 'rename' && checklist) {
        await updateChecklist(checklist.id, { name: trimmed });
        onRenamed?.(trimmed);
      } else {
        const created =
          copyFrom != null
            ? await cloneChecklist(warehouseId, copyFrom, trimmed)
            : await createChecklist({ warehouse_id: warehouseId, name: trimmed });
        onCreated?.(created.id);
      }
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
            {mode === 'rename' ? 'Rename checklist' : 'New checklist'}
          </Text>
          <Pressable hitSlop={12} onPress={save} disabled={saving} style={styles.topBarBtn}>
            <Text style={[styles.save, saving && { opacity: 0.4 }]}>
              {mode === 'rename' ? 'Save' : 'Create'}
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.fieldLabel}>NAME</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder='e.g. "Car kit", "Baby supplies"'
            placeholderTextColor={colors.textSubtle}
            style={styles.input}
            autoFocus
          />

          {mode === 'create' && (
            <>
              <Text style={styles.fieldLabel}>START FROM</Text>
              <Text style={styles.hint}>
                Blank, or copy all items from an existing checklist (e.g. the FEMA kit).
              </Text>
              <View style={styles.options}>
                <Option
                  label="Blank checklist"
                  active={copyFrom == null}
                  onPress={() => pickSource(null)}
                />
                {sources.map((s) => (
                  <Option
                    key={s.id}
                    label={`Copy “${s.name}”`}
                    active={copyFrom === s.id}
                    onPress={() => pickSource(s.id)}
                  />
                ))}
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Option({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        active ? styles.optionActive : styles.optionInactive,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.optionText, active && { color: colors.primary, fontWeight: '700' }]}>
        {label}
      </Text>
      {active && (
        <View style={styles.optionCheck}>
          <Text style={styles.optionCheckMark}>✓</Text>
        </View>
      )}
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
  topBarBtn: { minWidth: 64, justifyContent: 'center' },
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
  options: { gap: spacing.xs + 2 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  optionActive: { backgroundColor: colors.primaryTint, borderColor: colors.primarySubtle },
  optionInactive: { backgroundColor: colors.surface, borderColor: colors.border },
  optionText: { ...typography.body, color: colors.text },
  optionCheck: { width: 20, alignItems: 'center' },
  optionCheckMark: { ...typography.body, color: colors.primary, fontWeight: '800' },
});
