// ============================================================================
// Kalta – ItemEditSheet
// Modal-like sheet for editing an existing item. Used from box/[id].tsx.
// ============================================================================
import { useEffect, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Image,
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
import * as ImagePicker from 'expo-image-picker';
import { getCachedUri } from '@/src/lib/imageCache';
import {
  addShoppingItem,
  deleteItem,
  findCustomProduct,
  getActiveUserId,
  listShoppingList,
  markItemCondition,
  moveItemQuantity,
  openOneItem,
  setCustomProductMinQuantity,
  supabase,
  updateItem,
} from '@/src/lib/supabase';
import { deleteProductImage, uploadProductImage } from '@/src/lib/storage';
import { BoxPicker } from './BoxPicker';
import { CategoryPickerSheet, CategoryPickerTrigger } from './CategoryPickerSheet';
import {
  NEVER_EXPIRES_DATE,
  UNITS,
  formatDate,
  fromIsoDate,
  getExpiryStatus,
  isNeverExpires,
  toIsoDate,
} from '@/src/types/database';
import type { Category, Item, Unit } from '@/src/types/database';
import { colors, radius, shadows, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';

export interface ItemEditSheetProps {
  item: Item;
  /** Warehouse context for image uploads (path is `{warehouseId}/...`). */
  warehouseId: string;
  onClose: () => void;
  onSaved: (updated: Item) => void;
  onDeleted: (itemId: string) => void;
  /**
   * Called after a successful "Mark one as opened" split. The returned
   * row is the opened sibling (new or updated); the source row was
   * decremented or deleted in the same transaction. Parents usually
   * just close the sheet and trust their own reload path (realtime sub
   * on box detail, manual reload on Items tab).
   */
  onOpened?: (opened: Item) => void;
  /** Called after item was moved (partially or fully) to another box.
   *  Parents should reload their item list. */
  onMoved?: () => void;
}

interface Draft {
  name: string;
  quantity: number;
  unit: Unit;
  expiry_date: string | null;
  category: Category | null;
  pack_count: number | null;
  image_url: string | null;
}

export function ItemEditSheet({
  item,
  warehouseId,
  onClose,
  onSaved,
  onDeleted,
  onOpened,
  onMoved,
}: ItemEditSheetProps) {
  const [draft, setDraft] = useState<Draft>({
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    expiry_date: item.expiry_date,
    category: item.category,
    pack_count: item.pack_count,
    image_url: item.image_url,
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [showBoxPicker, setShowBoxPicker] = useState(false);
  const [showConditionSheet, setShowConditionSheet] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [condOpened, setCondOpened] = useState(false);
  const [condDamaged, setCondDamaged] = useState(false);
  const [condNotes, setCondNotes] = useState('');
  const [quantityText, setQuantityText] = useState(
    Number.isInteger(item.quantity) ? String(item.quantity) : item.quantity.toString(),
  );
  const [packCountText, setPackCountText] = useState(
    item.pack_count != null ? String(item.pack_count) : '',
  );
  const [energyText, setEnergyText] = useState(
    item.energy_kcal_per_100g != null ? String(item.energy_kcal_per_100g) : '',
  );
  const [netWeightText, setNetWeightText] = useState(
    item.net_weight_g != null ? String(item.net_weight_g) : '',
  );
  const [minQtyText, setMinQtyText] = useState(
    item.min_quantity != null ? String(item.min_quantity) : '',
  );

  // Reset form when the item changes (user closes and opens a different one)
  useEffect(() => {
    setDraft({
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      expiry_date: item.expiry_date,
      category: item.category,
      pack_count: item.pack_count,
      image_url: item.image_url,
    });
    setQuantityText(
      Number.isInteger(item.quantity) ? String(item.quantity) : item.quantity.toString(),
    );
    setPackCountText(item.pack_count != null ? String(item.pack_count) : '');
    setEnergyText(item.energy_kcal_per_100g != null ? String(item.energy_kcal_per_100g) : '');
    setNetWeightText(item.net_weight_g != null ? String(item.net_weight_g) : '');
    setMinQtyText(item.min_quantity != null ? String(item.min_quantity) : '');
    setShowDatePicker(false);
  }, [item.id]);

  // Barcoded products store their par level on the shared custom_products row
  // (aggregate across all boxes), not per item. Load that value so the field
  // reflects the real threshold instead of the unused per-row column.
  useEffect(() => {
    if (!item.barcode || !warehouseId) return;
    let cancelled = false;
    findCustomProduct(warehouseId, item.barcode)
      .then((cp) => {
        if (!cancelled) setMinQtyText(cp?.min_quantity != null ? String(cp.min_quantity) : '');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [item.id, item.barcode, warehouseId]);

  // Condition marking available for discrete units (pcs/pack).
  const canMarkCondition =
    (item.unit === 'pcs' || item.unit === 'pack') && item.quantity >= 1;

  const openConditionSheet = () => {
    setCondOpened(item.opened);
    setCondDamaged(item.damaged);
    setCondNotes(item.notes ?? '');
    setShowConditionSheet(true);
  };

  const handleConfirmCondition = async () => {
    try {
      setSaving(true);
      const userId = (await getActiveUserId()) ?? '';
      await markItemCondition(
        item.id,
        { opened: condOpened, damaged: condDamaged, notes: condNotes.trim() || null },
        userId,
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setShowConditionSheet(false);
      onOpened?.({} as any);
      onClose();
    } catch (e: any) {
      setSaving(false);
      Alert.alert('Error', e?.message ?? 'Cannot mark condition.');
    }
  };

  // ---- Image picker flow --------------------------------------------------

  const runImageUpload = async (localUri: string) => {
    try {
      setUploadingImage(true);
      const previousUrl = draft.image_url;
      const newUrl = await uploadProductImage(warehouseId, localUri);
      setDraft((d) => ({ ...d, image_url: newUrl }));
      // Fire-and-forget: remove the old one. Errors here are non-fatal.
      if (previousUrl && previousUrl !== item.image_url) {
        deleteProductImage(previousUrl).catch(() => {});
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message ?? 'Cannot upload image.');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleTakePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera access needed', 'Enable camera access in iOS Settings.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 1,
      mediaTypes: ['images'],
    });
    if (result.canceled || !result.assets[0]) return;
    await runImageUpload(result.assets[0].uri);
  };

  const handlePickFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photo library access needed', 'Enable photo library access in iOS Settings.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      quality: 1,
      mediaTypes: ['images'],
    });
    if (result.canceled || !result.assets[0]) return;
    await runImageUpload(result.assets[0].uri);
  };

  const handleRemoveImage = () => {
    const current = draft.image_url;
    if (!current) return;
    setDraft((d) => ({ ...d, image_url: null }));
    // Only delete from storage if it was a freshly uploaded one we own.
    // For images that came with the DB row (e.g. from OFF), we leave the
    // remote file alone — they may belong to another item or a CDN.
    if (current !== item.image_url) {
      deleteProductImage(current).catch(() => {});
    }
  };

  const showImagePicker = () => {
    if (uploadingImage) return;
    const hasImage = draft.image_url != null;
    const options = hasImage
      ? ['Take photo', 'Choose from library', 'Remove photo', 'Cancel']
      : ['Take photo', 'Choose from library', 'Cancel'];
    const removeIdx = hasImage ? 2 : -1;
    const cancelIdx = options.length - 1;

    ActionSheetIOS.showActionSheetWithOptions(
      {
        options,
        destructiveButtonIndex: removeIdx >= 0 ? removeIdx : undefined,
        cancelButtonIndex: cancelIdx,
        title: 'Item photo',
      },
      (idx) => {
        if (idx === 0) handleTakePhoto();
        else if (idx === 1) handlePickFromLibrary();
        else if (idx === removeIdx) handleRemoveImage();
      },
    );
  };

  // handleMarkOpened kept as legacy for swipe action — delegates to
  // openOneItem RPC for the quick "just open one" path.
  const handleMarkOpened = () => {
    Alert.alert(
      'Mark one as opened',
      `Decrement sealed count by 1 and push one unit to an opened sibling. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark opened',
          onPress: async () => {
            try {
              setSaving(true);
              const result = await openOneItem(item.id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              onOpened?.(result);
              onClose();
            } catch (e: any) {
              setSaving(false);
              Alert.alert('Error', e?.message ?? 'Cannot open.');
            }
          },
        },
      ],
    );
  };

  // ---- Move to another box -------------------------------------------------

  const handleMoveToBox = async (targetBox: { id: string; name: string }) => {
    setShowBoxPicker(false);

    const doMove = async (qty: number | 'all') => {
      try {
        setSaving(true);
        const { data: sess } = await supabase.auth.getSession();
        const userId = sess.session?.user.id ?? '';
        await moveItemQuantity(item.id, qty, targetBox.id, userId);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onMoved?.();
        onClose();
      } catch (e: any) {
        setSaving(false);
        Alert.alert('Error', e?.message ?? 'Cannot move item.');
      }
    };

    if (item.quantity <= 1) {
      // Only 1 unit — move it directly
      Alert.alert(
        'Move item',
        `Move "${item.name}" to "${targetBox.name}"?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Move', onPress: () => doMove('all') },
        ],
      );
    } else {
      // Multiple units — ask how many
      Alert.alert(
        'Move how many?',
        `"${item.name}" has ${item.quantity} ${item.unit}. Move all or just some to "${targetBox.name}"?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Move all', onPress: () => doMove('all') },
          {
            text: 'Choose amount',
            onPress: () => {
              Alert.prompt(
                'How many to move?',
                `Enter quantity (1–${item.quantity - 1}):`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Move',
                    onPress: (text?: string) => {
                      const n = parseInt(text ?? '', 10);
                      if (!n || n <= 0) {
                        Alert.alert('Invalid', 'Enter a positive number.');
                        return;
                      }
                      if (n >= item.quantity) {
                        doMove('all');
                      } else {
                        doMove(n);
                      }
                    },
                  },
                ],
                'plain-text',
                '1',
                'number-pad',
              );
            },
          },
        ],
      );
    }
  };

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

  // Add a row to the warehouse shopping list referencing this item, so the
  // user can put it on the list directly from the edit sheet (without having
  // to open Shopping → Refresh suggestions). Dedupes by case-insensitive
  // label against existing rows so re-tapping doesn't pile up duplicates.
  const handleAddToShopping = async () => {
    const label = draft.name.trim() || item.name;
    if (!label) return;
    try {
      const existing = await listShoppingList(warehouseId).catch(() => []);
      const dupe = existing.find(
        (r) => r.label.trim().toLowerCase() === label.toLowerCase() && !r.checked,
      );
      if (dupe) {
        Alert.alert(
          'Already on list',
          `"${label}" is already on your shopping list as ${dupe.source.replace('_', ' ')}.`,
        );
        return;
      }
      // Source classification: expired wins (clear signal); otherwise treat as
      // a manual add. Low-stock isn't determined from the sheet because the
      // aggregate-across-boxes math lives on the warehouse-level scan.
      const source = getExpiryStatus(item.expiry_date) === 'expired' ? 'expired' : 'manual';
      await addShoppingItem({
        warehouse_id: warehouseId,
        label,
        category: draft.category,
        source,
        source_ref: item.barcode ?? item.id,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert('Added to shopping list', `"${label}" was added.`);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Cannot add to shopping list.');
    }
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
      // pack_count: parse from text, null if empty or invalid
      const trimmedPack = packCountText.trim();
      let packCount: number | null = null;
      if (trimmedPack) {
        const parsed = parseInt(trimmedPack, 10);
        if (Number.isFinite(parsed) && parsed > 0) packCount = parsed;
      }
      const isFoodOrWater = draft.category === 'food' || draft.category === 'water';
      const energy = isFoodOrWater ? parsePositiveNumber(energyText) : null;
      const netWeight = isFoodOrWater ? parsePositiveNumber(netWeightText) : null;
      const minQty = parsePositiveNumber(minQtyText);

      const patch: Parameters<typeof updateItem>[1] = {
        name,
        quantity: qty,
        unit: draft.unit,
        expiry_date: draft.expiry_date ?? null,
        category: draft.category,
        pack_count: packCount,
        image_url: draft.image_url,
        energy_kcal_per_100g: energy,
        net_weight_g: netWeight,
      };
      // Smart-write par level: barcoded products store it as an aggregate on
      // custom_products; no-barcode items store it per row.
      if (!item.barcode) patch.min_quantity = minQty;
      const updated = await updateItem(item.id, patch);

      if (item.barcode) {
        const uid = (await getActiveUserId()) ?? '';
        await setCustomProductMinQuantity({
          warehouse_id: warehouseId,
          barcode: item.barcode,
          min: minQty,
          name,
          category: draft.category,
          created_by: uid,
        });
      }
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
          <Pressable
            onPress={showImagePicker}
            disabled={uploadingImage || saving}
            style={({ pressed }) => [styles.imageTile, pressed && { opacity: 0.7 }]}
          >
            {draft.image_url ? (
              <Image source={{ uri: getCachedUri(draft.image_url)! }} style={styles.imagePreview} />
            ) : (
              <View style={styles.imagePlaceholder}>
                <Icon sf="camera.fill" size={32} color={colors.textMuted} />
                <Text style={styles.imagePlaceholderText}>Add photo</Text>
              </View>
            )}
            {uploadingImage && (
              <View style={styles.imageOverlay}>
                <ActivityIndicator color="#FFFFFF" />
              </View>
            )}
          </Pressable>

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
                onChangeText={(v) => setQuantityText(v.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
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

          {draft.unit === 'pack' && (
            <>
              <Text style={styles.label}>Pcs inside one package (optional)</Text>
              <TextInput
                value={packCountText}
                onChangeText={setPackCountText}
                placeholder="e.g. 24"
                placeholderTextColor={colors.textSubtle}
                keyboardType="number-pad"
                style={styles.input}
              />
            </>
          )}

          <Text style={styles.label}>Expiry</Text>
          <View style={styles.expirySegmented}>
            <Pressable
              style={[
                styles.expirySegment,
                !isNeverExpires(draft.expiry_date) && styles.expirySegmentActive,
              ]}
              onPress={() => {
                if (isNeverExpires(draft.expiry_date)) {
                  setDraft({ ...draft, expiry_date: null });
                  setShowDatePicker(false);
                }
              }}
            >
              <Text
                style={[
                  styles.expirySegmentText,
                  !isNeverExpires(draft.expiry_date) && styles.expirySegmentTextActive,
                ]}
              >
                Has expiry
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.expirySegment,
                isNeverExpires(draft.expiry_date) && styles.expirySegmentActive,
              ]}
              onPress={() => {
                setDraft({ ...draft, expiry_date: NEVER_EXPIRES_DATE });
                setShowDatePicker(false);
              }}
            >
              <Text
                style={[
                  styles.expirySegmentText,
                  isNeverExpires(draft.expiry_date) && styles.expirySegmentTextActive,
                ]}
              >
                Never expires
              </Text>
            </Pressable>
          </View>

          {!isNeverExpires(draft.expiry_date) && (
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
          )}
          {!isNeverExpires(draft.expiry_date) && showDatePicker && (
            <View style={styles.datePickerWrap}>
              <DateTimePicker
                value={fromIsoDate(draft.expiry_date ?? '') ?? new Date()}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                themeVariant="light"
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
          <CategoryPickerTrigger
            value={draft.category}
            onPress={() => setShowCategoryPicker(true)}
          />

          {(draft.category === 'food' || draft.category === 'water') && (
            <View style={styles.row}>
              {draft.category === 'food' && (
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>kcal / 100 g</Text>
                  <TextInput
                    value={energyText}
                    onChangeText={setEnergyText}
                    placeholder="e.g. 350"
                    placeholderTextColor={colors.textSubtle}
                    keyboardType="decimal-pad"
                    style={styles.input}
                  />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>
                  {draft.category === 'water' ? 'Content per item (ml)' : 'Content per item (g)'}
                </Text>
                <TextInput
                  value={netWeightText}
                  onChangeText={setNetWeightText}
                  placeholder={draft.category === 'water' ? 'e.g. 1500' : 'e.g. 500'}
                  placeholderTextColor={colors.textSubtle}
                  keyboardType="decimal-pad"
                  style={styles.input}
                />
              </View>
            </View>
          )}

          <Text style={styles.label}>
            {item.barcode ? 'Minimum to keep (all boxes)' : 'Low-stock alert below'}
          </Text>
          <TextInput
            value={minQtyText}
            onChangeText={setMinQtyText}
            placeholder="e.g. 2"
            placeholderTextColor={colors.textSubtle}
            keyboardType="decimal-pad"
            style={styles.input}
          />
          {!!item.barcode && (
            <Text style={styles.minHint}>
              Applies to the total of this product across every box.
            </Text>
          )}

          <Pressable
            style={[styles.savePrimaryBtn, saving && { opacity: 0.7 }]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.savePrimaryBtnText}>Save changes</Text>
            )}
          </Pressable>

          {canMarkCondition && (
            <Pressable
              style={[styles.openBtn, saving && { opacity: 0.5 }]}
              onPress={openConditionSheet}
              disabled={saving}
            >
              <View style={styles.openBtnContent}>
                <Icon sf="tag.fill" size={18} color={colors.warningText} />
                <Text style={styles.openBtnText}>
                  {item.quantity > 1 ? 'Mark condition (split 1 unit)' : 'Mark condition'}
                </Text>
              </View>
            </Pressable>
          )}

          <Pressable
            style={[styles.shoppingBtn, saving && { opacity: 0.5 }]}
            onPress={handleAddToShopping}
            disabled={saving}
          >
            <View style={styles.shoppingBtnContent}>
              <Icon sf="cart.badge.plus" size={18} color={colors.primary} />
              <Text style={styles.shoppingBtnText}>Add to shopping list</Text>
            </View>
          </Pressable>

          <Pressable
            style={[styles.moveBtn, saving && { opacity: 0.5 }]}
            onPress={() => setShowBoxPicker(true)}
            disabled={saving}
          >
            <View style={styles.moveBtnContent}>
              <Icon sf="arrow.right.arrow.left" size={18} color={colors.primary} />
              <Text style={styles.moveBtnText}>Move to another box</Text>
            </View>
          </Pressable>

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

      <CategoryPickerSheet
        visible={showCategoryPicker}
        value={draft.category}
        onSelect={(c) => setDraft({ ...draft, category: c })}
        onClose={() => setShowCategoryPicker(false)}
      />

      {/* Box picker for move */}
      <Modal
        visible={showBoxPicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowBoxPicker(false)}
      >
        <BoxPicker
          warehouseId={warehouseId}
          excludeBoxId={item.box_id}
          onSelect={(box) => handleMoveToBox(box)}
          onClose={() => setShowBoxPicker(false)}
        />
      </Modal>

      {/* Condition marking sheet */}
      <Modal
        visible={showConditionSheet}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowConditionSheet(false)}
      >
        <SafeAreaView style={styles.condContainer} edges={['top', 'bottom']}>
          <View style={styles.condHeader}>
            <Text style={styles.condTitle}>
              {item.quantity > 1 ? 'Mark condition (splits 1 unit)' : 'Mark condition'}
            </Text>
            <Pressable hitSlop={12} onPress={() => setShowConditionSheet(false)}>
              <Text style={styles.condClose}>Cancel</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.condBody}>
            <Text style={styles.condHint}>
              {item.quantity > 1
                ? 'This will split off 1 unit with the selected conditions. The rest stays unchanged.'
                : 'Set the condition of this item.'}
            </Text>

            <View style={styles.condToggleRow}>
              <View style={styles.condToggleText}>
                <Text style={styles.condToggleLabel}>Opened</Text>
                <Text style={styles.condToggleHint}>Package has been started</Text>
              </View>
              <Pressable
                onPress={() => setCondOpened((v) => !v)}
                style={styles.condCheckbox}
              >
                <Icon
                  sf={condOpened ? 'checkmark.square.fill' : 'square'}
                  size={24}
                  color={condOpened ? colors.warningText : colors.textMuted}
                />
              </Pressable>
            </View>

            <View style={styles.condToggleRow}>
              <View style={styles.condToggleText}>
                <Text style={styles.condToggleLabel}>Damaged packaging</Text>
                <Text style={styles.condToggleHint}>Packaging is compromised or torn</Text>
              </View>
              <Pressable
                onPress={() => setCondDamaged((v) => !v)}
                style={styles.condCheckbox}
              >
                <Icon
                  sf={condDamaged ? 'checkmark.square.fill' : 'square'}
                  size={24}
                  color={condDamaged ? colors.danger : colors.textMuted}
                />
              </Pressable>
            </View>

            <Text style={styles.condNotesLabel}>Notes (optional)</Text>
            <TextInput
              value={condNotes}
              onChangeText={setCondNotes}
              placeholder="E.g. dent on top, seal broken..."
              placeholderTextColor={colors.textSubtle}
              style={styles.condNotesInput}
              multiline
              numberOfLines={3}
            />

            <Pressable
              style={({ pressed }) => [
                styles.condConfirmBtn,
                saving && { opacity: 0.6 },
                pressed && !saving && { opacity: 0.8 },
              ]}
              onPress={handleConfirmCondition}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color={colors.textOnPrimary} />
              ) : (
                <Text style={styles.condConfirmText}>
                  {item.quantity > 1 ? 'Split & mark' : 'Save condition'}
                </Text>
              )}
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

/** Parse a free-text numeric field into a positive number, else null. */
function parsePositiveNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const n = parseFloat(trimmed.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
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
  imageTile: {
    alignSelf: 'center',
    width: 160,
    height: 160,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  imagePreview: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  imagePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
  },
  imagePlaceholderText: {
    ...typography.footnote,
    color: colors.textMuted,
    fontWeight: '600',
  },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  minHint: {
    ...typography.footnote,
    color: colors.textMuted,
    marginTop: spacing.xs,
    marginLeft: spacing.xs,
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
  expirySegmentText: {
    ...typography.footnote,
    color: colors.textMuted,
    fontWeight: '600',
  },
  expirySegmentTextActive: {
    color: colors.text,
  },
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
  savePrimaryBtn: {
    marginTop: spacing.xl,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  savePrimaryBtnText: {
    ...typography.bodyStrong,
    color: colors.textOnPrimary,
  },
  openBtn: {
    marginTop: spacing.xl,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.md,
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.warningBgStrong,
    alignItems: 'center',
  },
  openBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  openBtnText: {
    ...typography.subhead,
    color: colors.warningText,
    fontWeight: '700',
  },
  // Condition sheet
  condContainer: { flex: 1, backgroundColor: colors.background },
  condHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  condTitle: { ...typography.headline, color: colors.text, flex: 1, marginRight: spacing.md },
  condClose: { ...typography.body, color: colors.primary, fontWeight: '600' },
  condBody: { padding: spacing.lg, gap: spacing.md },
  condHint: { ...typography.footnote, color: colors.textMuted, lineHeight: 19 },
  condToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md + 2,
    gap: spacing.md,
  },
  condToggleText: { flex: 1, gap: 4 },
  condToggleLabel: { ...typography.body, color: colors.text, fontWeight: '600' },
  condToggleHint: { ...typography.footnote, color: colors.textMuted },
  condCheckbox: { padding: spacing.xs },
  condNotesLabel: { ...typography.label, color: colors.textMuted, marginTop: spacing.sm },
  condNotesInput: {
    ...typography.body,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  condConfirmBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  condConfirmText: { ...typography.bodyStrong, color: colors.textOnPrimary },

  moveBtn: {
    marginTop: spacing.sm,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.md,
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primarySubtle,
    alignItems: 'center',
  },
  moveBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  moveBtnText: {
    ...typography.subhead,
    color: colors.primary,
    fontWeight: '700',
  },
  shoppingBtn: {
    marginTop: spacing.lg,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primarySubtle,
    alignItems: 'center',
  },
  shoppingBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  shoppingBtnText: {
    ...typography.subhead,
    color: colors.primary,
    fontWeight: '700',
  },
  deleteBtn: {
    marginTop: spacing.md,
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
