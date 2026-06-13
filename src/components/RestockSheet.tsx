// ============================================================================
// Kalta – Restock sheet
// Lightweight inventory-add flow opened from the shopping list for SPECIFIC
// rows (source = low_stock | expired) where we already know the product.
// User only chooses quantity, expiry, and target box. Saving creates one
// inventory row (cloning metadata from the source item) and deletes the
// shopping row. Generic rows (source = gap | manual) skip this sheet and
// go straight to add-items — see shopping.tsx.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
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
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { addOrMergeItem, deleteShoppingItem, getActiveUserId, getBoxById } from '@/src/lib/supabase';
import {
  NEVER_EXPIRES_DATE,
  formatDate,
  fromIsoDate,
  isNeverExpires,
  toIsoDate,
} from '@/src/types/database';
import type { Box, Item, ShoppingListItem } from '@/src/types/database';
import { BoxPicker } from './BoxPicker';
import { Icon } from './Icon';
import { colors, radius, shadows, spacing, typography } from '@/src/theme';

interface Props {
  visible: boolean;
  warehouseId: string;
  /** Row being restocked. */
  shoppingItem: ShoppingListItem;
  /** Existing inventory item the row was derived from (low_stock/expired source).
   *  Drives pre-fill of name, category, net_weight, kcal, target box. */
  sourceItem: Item | null;
  /** Typical shelf life in days for the underlying custom product. Pre-fills
   *  a suggested expiry date when known. */
  typicalExpiryDays: number | null;
  onClose: () => void;
  /** Called after the inventory item is created and the shopping row deleted. */
  onRestocked: () => void;
}

export function RestockSheet({
  visible,
  warehouseId,
  shoppingItem,
  sourceItem,
  typicalExpiryDays,
  onClose,
  onRestocked,
}: Props) {
  const router = useRouter();
  const [quantityText, setQuantityText] = useState('1');
  const [expiry, setExpiry] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [targetBox, setTargetBox] = useState<Box | null>(null);
  const [showBoxPicker, setShowBoxPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reset + seed defaults whenever the sheet opens against a new row.
  useEffect(() => {
    if (!visible) return;
    setQuantityText('1');
    setShowDatePicker(false);
    // Default expiry from typical shelf life (e.g. canned food ~2 years)
    // — user can override or switch to Never expires.
    if (typicalExpiryDays != null && typicalExpiryDays > 0) {
      const d = new Date();
      d.setDate(d.getDate() + typicalExpiryDays);
      setExpiry(toIsoDate(d));
    } else {
      setExpiry(null);
    }
    // Pre-select the box the item came from (where it ran low / expired) so
    // restock returns to its origin by default — user can still change it.
    if (sourceItem?.box_id) {
      getBoxById(sourceItem.box_id)
        .then((b) => setTargetBox(b))
        .catch(() => setTargetBox(null));
    } else {
      setTargetBox(null);
    }
  }, [visible, shoppingItem.id, typicalExpiryDays, sourceItem?.box_id]);

  const handleSave = async () => {
    const qty = parseInt(quantityText.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      Alert.alert('Quantity required', 'Enter a positive whole number.');
      return;
    }
    if (!expiry) {
      Alert.alert('Expiry required', 'Pick a date or choose "Never expires".');
      return;
    }
    if (!targetBox) {
      Alert.alert('Box required', 'Pick which box this is going into.');
      return;
    }
    try {
      setSaving(true);
      const userId = (await getActiveUserId()) ?? '';
      // Clone metadata from the source item when available so readiness math
      // works without forcing the user to re-enter kcal / net weight. Merges
      // into a matching same-expiry row in the box (else creates a new batch).
      await addOrMergeItem(targetBox.id, userId, {
        name: sourceItem?.name ?? shoppingItem.label,
        quantity: qty,
        unit: sourceItem?.unit ?? 'pcs',
        expiry_date: expiry,
        barcode: sourceItem?.barcode ?? null,
        image_url: sourceItem?.image_url ?? null,
        category: sourceItem?.category ?? shoppingItem.category,
        pack_count: sourceItem?.pack_count ?? null,
        energy_kcal_per_100g: sourceItem?.energy_kcal_per_100g ?? null,
        net_weight_g: sourceItem?.net_weight_g ?? null,
      });
      await deleteShoppingItem(shoppingItem.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onRestocked();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Cannot restock.');
    } finally {
      setSaving(false);
    }
  };

  const handleSwitchToFullFlow = () => {
    // Escape hatch: the source product no longer matches what the user
    // actually bought (e.g. switched brand). Jump to add-items with the
    // shopping context so the row still clears once the new item is saved.
    if (!targetBox) {
      Alert.alert('Pick a box first', 'Choose where to put the items.');
      return;
    }
    onClose();
    router.push({
      pathname: `/warehouse/${warehouseId}/box/${targetBox.id}/add-items` as any,
      params: {
        prefillName: shoppingItem.label,
        prefillCategory: shoppingItem.category ?? '',
        shoppingItemId: shoppingItem.id,
      },
    });
  };

  const displayName = sourceItem?.name ?? shoppingItem.label;

  return (
    <Modal
      visible={visible}
      presentationStyle="pageSheet"
      animationType="slide"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable hitSlop={12} onPress={onClose} disabled={saving}>
            <Text style={[styles.headerBtn, saving && { opacity: 0.4 }]}>Cancel</Text>
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Restock
          </Text>
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
            <View style={styles.productCard}>
              <Text style={styles.productLabel}>Restocking</Text>
              <Text style={styles.productName} numberOfLines={2}>
                {displayName}
              </Text>
              {sourceItem && (
                <Text style={styles.productMeta}>
                  Cloning metadata from previously stocked item
                  {sourceItem.net_weight_g != null
                    ? ` · ${sourceItem.net_weight_g} ${sourceItem.category === 'water' ? 'ml' : 'g'} per unit`
                    : ''}
                </Text>
              )}
            </View>

            <Text style={styles.label}>Quantity</Text>
            <TextInput
              style={styles.input}
              value={quantityText}
              onChangeText={(v) => setQuantityText(v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="1"
              placeholderTextColor={colors.textSubtle}
            />

            <Text style={styles.label}>Expiry</Text>
            <View style={styles.expirySegmented}>
              <Pressable
                style={[
                  styles.expirySegment,
                  !isNeverExpires(expiry) && styles.expirySegmentActive,
                ]}
                onPress={() => {
                  if (isNeverExpires(expiry)) {
                    setExpiry(null);
                    setShowDatePicker(false);
                  }
                }}
              >
                <Text
                  style={[
                    styles.expirySegmentText,
                    !isNeverExpires(expiry) && styles.expirySegmentTextActive,
                  ]}
                >
                  Has expiry
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.expirySegment,
                  isNeverExpires(expiry) && styles.expirySegmentActive,
                ]}
                onPress={() => {
                  setExpiry(NEVER_EXPIRES_DATE);
                  setShowDatePicker(false);
                }}
              >
                <Text
                  style={[
                    styles.expirySegmentText,
                    isNeverExpires(expiry) && styles.expirySegmentTextActive,
                  ]}
                >
                  Never expires
                </Text>
              </Pressable>
            </View>

            {!isNeverExpires(expiry) && (
              <Pressable
                style={[styles.input, styles.dateField]}
                onPress={() => setShowDatePicker((s) => !s)}
              >
                <Text style={[styles.dateText, !expiry && styles.datePlaceholder]}>
                  {expiry ? formatDate(expiry) : 'Pick a date'}
                </Text>
                <Icon
                  sf={showDatePicker ? 'chevron.up' : 'chevron.down'}
                  size={14}
                  color={colors.textMuted}
                />
              </Pressable>
            )}
            {!isNeverExpires(expiry) && typicalExpiryDays != null && (
              <Text style={styles.hint}>
                Suggested from typical shelf life — adjust to what's on the label.
              </Text>
            )}
            {!isNeverExpires(expiry) && showDatePicker && (
              <View style={styles.datePickerWrap}>
                <DateTimePicker
                  value={fromIsoDate(expiry ?? '') ?? new Date()}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'inline' : 'default'}
                  themeVariant="light"
                  minimumDate={new Date(2000, 0, 1)}
                  locale="en-GB"
                  onChange={(event: DateTimePickerEvent, selected?: Date) => {
                    if (Platform.OS === 'android') setShowDatePicker(false);
                    if (event.type === 'dismissed') return;
                    if (selected) setExpiry(toIsoDate(selected));
                  }}
                />
              </View>
            )}

            <Text style={styles.label}>Box</Text>
            <Pressable
              style={[styles.input, styles.boxRow]}
              onPress={() => setShowBoxPicker(true)}
            >
              <Text style={[styles.boxText, !targetBox && styles.datePlaceholder]}>
                {targetBox ? targetBox.name : 'Pick a box'}
              </Text>
              <Icon sf="chevron.right" size={14} color={colors.textMuted} />
            </Pressable>

            <Pressable
              style={[styles.savePrimaryBtn, saving && { opacity: 0.7 }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color={colors.textOnPrimary} />
              ) : (
                <Text style={styles.savePrimaryBtnText}>Restock {quantityText || '1'} into inventory</Text>
              )}
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.escapeRow, pressed && { opacity: 0.6 }]}
              onPress={handleSwitchToFullFlow}
            >
              <Icon sf="barcode.viewfinder" size={14} color={colors.primary} />
              <Text style={styles.escapeText}>
                Different product? Open full add-items
              </Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>

        <Modal
          visible={showBoxPicker}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowBoxPicker(false)}
        >
          <BoxPicker
            warehouseId={warehouseId}
            onSelect={(box) => {
              setTargetBox(box as Box);
              setShowBoxPicker(false);
            }}
            onClose={() => setShowBoxPicker(false)}
          />
        </Modal>
      </SafeAreaView>
    </Modal>
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
  headerTitle: { ...typography.headline, color: colors.text, flex: 1, textAlign: 'center', marginHorizontal: spacing.md },
  headerBtn: { ...typography.callout, color: colors.primary, fontWeight: '500' },
  headerBtnPrimary: { fontWeight: '700' },
  scroll: { padding: spacing.lg, gap: spacing.xs },
  productCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: 4,
  },
  productLabel: { ...typography.caption, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  productName: { ...typography.headline, color: colors.text },
  productMeta: { ...typography.footnote, color: colors.textMuted, marginTop: 2 },
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
  expirySegmented: {
    flexDirection: 'row',
    backgroundColor: colors.palette.neutral[100],
    borderRadius: radius.md,
    padding: 3,
    marginBottom: spacing.sm,
  },
  expirySegment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm + 1,
    borderRadius: radius.md - 3,
  },
  expirySegmentActive: {
    backgroundColor: colors.surface,
    ...shadows.sm,
  },
  expirySegmentText: { ...typography.footnote, color: colors.textMuted, fontWeight: '600' },
  expirySegmentTextActive: { color: colors.text },
  dateField: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dateText: { ...typography.body, color: colors.text, fontWeight: '500' },
  datePlaceholder: { color: colors.textSubtle, fontWeight: '400' },
  datePickerWrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  hint: {
    ...typography.footnote,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginTop: spacing.xs,
    marginLeft: spacing.xs,
  },
  boxRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  boxText: { ...typography.body, color: colors.text, fontWeight: '500' },
  savePrimaryBtn: {
    marginTop: spacing.xl,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  savePrimaryBtnText: { ...typography.bodyStrong, color: colors.textOnPrimary },
  escapeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
  },
  escapeText: { ...typography.footnote, color: colors.primary, fontWeight: '600' },
});
