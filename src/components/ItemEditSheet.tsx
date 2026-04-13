// ============================================================================
// Stockr – ItemEditSheet
// Modal-like sheet for editing an existing item. Used from box/[id].tsx.
// ============================================================================
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { deleteItem, updateItem } from '@/src/lib/supabase';
import {
  CATEGORIES,
  UNITS,
  formatDate,
  fromIsoDate,
  toIsoDate,
} from '@/src/types/database';
import type { Category, Item, Unit } from '@/src/types/database';
import { colors, radius, shadows, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';

export interface ItemEditSheetProps {
  item: Item;
  onClose: () => void;
  onSaved: (updated: Item) => void;
  onDeleted: (itemId: string) => void;
}

interface Draft {
  name: string;
  quantity: number;
  unit: Unit;
  expiry_date: string | null;
  category: Category | null;
}

export function ItemEditSheet({ item, onClose, onSaved, onDeleted }: ItemEditSheetProps) {
  const [draft, setDraft] = useState<Draft>({
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    expiry_date: item.expiry_date,
    category: item.category,
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [quantityText, setQuantityText] = useState(
    Number.isInteger(item.quantity) ? String(item.quantity) : item.quantity.toString(),
  );

  // Reset form when the item changes (user closes and opens a different one)
  useEffect(() => {
    setDraft({
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      expiry_date: item.expiry_date,
      category: item.category,
    });
    setQuantityText(
      Number.isInteger(item.quantity) ? String(item.quantity) : item.quantity.toString(),
    );
    setShowDatePicker(false);
  }, [item.id]);

  const handleDelete = () => {
    Alert.alert('Delete item', `Really delete "${item.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            setSaving(true);
            await deleteItem(item.id);
            onDeleted(item.id);
          } catch (e: any) {
            setSaving(false);
            Alert.alert('Error', e?.message ?? 'Cannot delete.');
          }
        },
      },
    ]);
  };

  const handleSave = async () => {
    const name = draft.name.trim();
    if (!name) {
      Alert.alert('Name required', 'Enter a product name.');
      return;
    }
    const qty = parseFloat(quantityText.replace(',', '.'));
    if (!qty || qty <= 0) {
      Alert.alert('Invalid quantity', 'Enter a positive number.');
      return;
    }
    try {
      setSaving(true);
      const updated = await updateItem(item.id, {
        name,
        quantity: qty,
        unit: draft.unit,
        expiry_date: draft.expiry_date ?? null,
        category: draft.category,
      });
      onSaved(updated);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Cannot save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={onClose} disabled={saving}>
          <Text style={[styles.headerBtn, saving && { opacity: 0.4 }]}>Cancel</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Edit item</Text>
        <Pressable hitSlop={12} onPress={handleSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={[styles.headerBtn, styles.headerBtnPrimary]}>Save</Text>
          )}
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Name</Text>
          <TextInput
            value={draft.name}
            onChangeText={(v) => setDraft({ ...draft, name: v })}
            placeholder="Product name"
            placeholderTextColor={colors.textSubtle}
            style={styles.input}
          />

          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Quantity</Text>
              <TextInput
                value={quantityText}
                onChangeText={setQuantityText}
                keyboardType="decimal-pad"
                style={styles.input}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Unit</Text>
              <ChipRow
                options={UNITS}
                value={draft.unit}
                onChange={(u) => u && setDraft({ ...draft, unit: u })}
              />
            </View>
          </View>

          <Text style={styles.label}>Expiry date</Text>
          <View style={styles.dateRow}>
            <Pressable
              style={[styles.input, styles.dateField, { flex: 1 }]}
              onPress={() => setShowDatePicker((s) => !s)}
            >
              <Text style={[styles.dateText, !draft.expiry_date && styles.datePlaceholder]}>
                {draft.expiry_date ? formatDate(draft.expiry_date) : 'No date'}
              </Text>
              <Icon
                sf={showDatePicker ? 'chevron.up' : 'chevron.down'}
                size={14}
                color={colors.textMuted}
              />
            </Pressable>
            {draft.expiry_date && (
              <Pressable
                style={styles.dateClearBtn}
                onPress={() => {
                  setDraft({ ...draft, expiry_date: null });
                  setShowDatePicker(false);
                }}
              >
                <Text style={styles.dateClearText}>Clear</Text>
              </Pressable>
            )}
          </View>
          {showDatePicker && (
            <View style={styles.datePickerWrap}>
              <DateTimePicker
                value={fromIsoDate(draft.expiry_date ?? '') ?? new Date()}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                minimumDate={new Date(2000, 0, 1)}
                locale="en-GB"
                onChange={(event: DateTimePickerEvent, selected?: Date) => {
                  if (Platform.OS === 'android') setShowDatePicker(false);
                  if (event.type === 'dismissed') return;
                  if (selected) {
                    setDraft({ ...draft, expiry_date: toIsoDate(selected) });
                  }
                }}
              />
            </View>
          )}

          <Text style={styles.label}>Category</Text>
          <ChipRow
            options={CATEGORIES}
            value={draft.category}
            onChange={(c) => setDraft({ ...draft, category: c })}
            renderLabel={(c) => c}
            allowNull
          />

          <Pressable
            style={[styles.deleteBtn, saving && { opacity: 0.5 }]}
            onPress={handleDelete}
            disabled={saving}
          >
            <View style={styles.deleteBtnContent}>
              <Icon sf="trash.fill" size={18} color={colors.danger} />
              <Text style={styles.deleteBtnText}>Delete item</Text>
            </View>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// ChipRow — internal helper
// ---------------------------------------------------------------------------
function ChipRow<T extends string>({
  options,
  value,
  onChange,
  renderLabel,
  allowNull,
}: {
  options: readonly T[];
  value: T | null;
  onChange: (v: T | null) => void;
  renderLabel?: (v: T) => string;
  allowNull?: boolean;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 6, paddingVertical: 2 }}
    >
      {options.map((opt) => {
        const active = value === opt;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(allowNull && active ? null : opt)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>
              {renderLabel ? renderLabel(opt) : opt}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerTitle: {
    ...typography.headline,
    color: colors.text,
  },
  headerBtn: {
    ...typography.callout,
    color: colors.primary,
    fontWeight: '500',
  },
  headerBtnPrimary: { fontWeight: '700' },
  scroll: { padding: spacing.lg, gap: spacing.xs },
  label: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: spacing.md + 2,
    marginBottom: spacing.xs + 2,
  },
  input: {
    ...typography.body,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: { flexDirection: 'row', gap: spacing.md },
  dateRow: { flexDirection: 'row', gap: spacing.sm },
  dateField: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md + 2,
  },
  dateText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '500',
  },
  datePlaceholder: { color: colors.textSubtle, fontWeight: '400' },
  dateChevron: {
    fontSize: 16,
    color: colors.textMuted,
  },
  dateClearBtn: {
    paddingHorizontal: spacing.md + 2,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateClearText: {
    ...typography.footnote,
    color: colors.danger,
    fontWeight: '600',
  },
  datePickerWrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    ...typography.footnote,
    color: colors.text,
    fontWeight: '600',
  },
  chipTextActive: { color: colors.textOnPrimary },
  deleteBtn: {
    marginTop: spacing.xxl,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.md,
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerBgStrong,
    alignItems: 'center',
  },
  deleteBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  deleteBtnText: {
    ...typography.subhead,
    color: colors.danger,
    fontWeight: '700',
  },
});
