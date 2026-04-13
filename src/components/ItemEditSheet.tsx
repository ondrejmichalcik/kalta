// ============================================================================
// Stockr – ItemEditSheet
// Modal-like sheet pro editaci existující položky. Používá se v box/[id].tsx.
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
  CATEGORY_EMOJI,
  UNITS,
  formatDateCs,
  fromIsoDate,
  toIsoDate,
} from '@/src/types/database';
import type { Category, Item, Unit } from '@/src/types/database';

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

  // Reset formuláře při změně item (když user zavře a otevře jiný)
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
    Alert.alert('Smazat položku', `Opravdu smazat „${item.name}"?`, [
      { text: 'Zrušit', style: 'cancel' },
      {
        text: 'Smazat',
        style: 'destructive',
        onPress: async () => {
          try {
            setSaving(true);
            await deleteItem(item.id);
            onDeleted(item.id);
          } catch (e: any) {
            setSaving(false);
            Alert.alert('Chyba', e?.message ?? 'Nelze smazat.');
          }
        },
      },
    ]);
  };

  const handleSave = async () => {
    const name = draft.name.trim();
    if (!name) {
      Alert.alert('Chybí název', 'Zadej název produktu.');
      return;
    }
    const qty = parseFloat(quantityText.replace(',', '.'));
    if (!qty || qty <= 0) {
      Alert.alert('Neplatné množství', 'Zadej kladné číslo.');
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
      Alert.alert('Chyba', e?.message ?? 'Nelze uložit.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={onClose} disabled={saving}>
          <Text style={[styles.headerBtn, saving && { opacity: 0.4 }]}>Zrušit</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Upravit položku</Text>
        <Pressable hitSlop={12} onPress={handleSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator />
          ) : (
            <Text style={[styles.headerBtn, styles.headerBtnPrimary]}>Uložit</Text>
          )}
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Název</Text>
          <TextInput
            value={draft.name}
            onChangeText={(v) => setDraft({ ...draft, name: v })}
            placeholder="Název produktu"
            placeholderTextColor="#B0B0B0"
            style={styles.input}
          />

          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Množství</Text>
              <TextInput
                value={quantityText}
                onChangeText={setQuantityText}
                keyboardType="decimal-pad"
                style={styles.input}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Jednotka</Text>
              <ChipRow
                options={UNITS}
                value={draft.unit}
                onChange={(u) => u && setDraft({ ...draft, unit: u })}
              />
            </View>
          </View>

          <Text style={styles.label}>Datum expirace</Text>
          <View style={styles.dateRow}>
            <Pressable
              style={[styles.input, styles.dateField, { flex: 1 }]}
              onPress={() => setShowDatePicker((s) => !s)}
            >
              <Text style={[styles.dateText, !draft.expiry_date && styles.datePlaceholder]}>
                {draft.expiry_date ? formatDateCs(draft.expiry_date) : 'Bez data'}
              </Text>
              <Text style={styles.dateChevron}>{showDatePicker ? '▴' : '▾'}</Text>
            </Pressable>
            {draft.expiry_date && (
              <Pressable
                style={styles.dateClearBtn}
                onPress={() => {
                  setDraft({ ...draft, expiry_date: null });
                  setShowDatePicker(false);
                }}
              >
                <Text style={styles.dateClearText}>Smazat</Text>
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
                locale="cs-CZ"
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

          <Text style={styles.label}>Kategorie</Text>
          <ChipRow
            options={CATEGORIES}
            value={draft.category}
            onChange={(c) => setDraft({ ...draft, category: c })}
            renderLabel={(c) => `${CATEGORY_EMOJI[c]} ${c}`}
            allowNull
          />

          <Pressable
            style={[styles.deleteBtn, saving && { opacity: 0.5 }]}
            onPress={handleDelete}
            disabled={saving}
          >
            <Text style={styles.deleteBtnText}>Smazat položku</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// ChipRow – vnitřní helper
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
  container: { flex: 1, backgroundColor: '#F5F5F7' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5E7',
    backgroundColor: '#fff',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#111' },
  headerBtn: { fontSize: 16, color: '#007AFF', fontWeight: '500' },
  headerBtnPrimary: { fontWeight: '700' },
  scroll: { padding: 16, gap: 4 },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginTop: 14,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111',
    borderWidth: 1,
    borderColor: '#E5E5E7',
  },
  row: { flexDirection: 'row', gap: 12 },
  dateRow: { flexDirection: 'row', gap: 8 },
  dateField: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
  },
  dateText: { fontSize: 16, color: '#111', fontWeight: '500' },
  datePlaceholder: { color: '#B0B0B0', fontWeight: '400' },
  dateChevron: { fontSize: 16, color: '#666' },
  dateClearBtn: {
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5E7',
  },
  dateClearText: { color: '#E23B3B', fontWeight: '600', fontSize: 13 },
  datePickerWrap: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#E5E5E7',
    overflow: 'hidden',
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E5E7',
  },
  chipActive: { backgroundColor: '#111', borderColor: '#111' },
  chipText: { color: '#111', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  deleteBtn: {
    marginTop: 32,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#FCEBEB',
    alignItems: 'center',
  },
  deleteBtnText: { color: '#E23B3B', fontWeight: '700', fontSize: 15 },
});
