// ============================================================================
// Stockr – Add items (batch session)
// Flow: EAN scan → OFF lookup → form → queue → save all
// ============================================================================
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import {
  addItemsBatch,
  findCustomProduct,
  supabase,
  upsertCustomProduct,
} from '@/src/lib/supabase';
import { lookupByBarcode } from '@/src/lib/openFoodFacts';
import {
  CATEGORIES,
  EXPIRY_COLORS,
  UNITS,
  formatDate,
  formatExpiry,
  formatItemQuantity,
  fromIsoDate,
  getExpiryStatus,
  toIsoDate,
} from '@/src/types/database';
import type { Category, Unit } from '@/src/types/database';
import { colors, radius, shadows, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';
import type { SFSymbolName } from '@/src/components/Icon';

// Category → SF Symbol mapping for this screen's form + queue chips.
const CATEGORY_SF: Record<Category, SFSymbolName> = {
  food: 'fork.knife',
  medicine: 'pills.fill',
  water: 'drop.fill',
  disinfectant: 'bubbles.and.sparkles.fill',
  equipment: 'wrench.adjustable.fill',
  energy: 'bolt.fill',
  documents: 'doc.fill',
  other: 'shippingbox.fill',
};

// ---------------------------------------------------------------------------
// Queue item – local state before batch save
// ---------------------------------------------------------------------------

interface Draft {
  localId: string;
  name: string;
  quantity: number;
  unit: Unit;
  expiry_date: string; // YYYY-MM-DD, required
  barcode: string | null;
  image_url: string | null;
  category: Category | null;
  pack_count: number | null;
}

type Mode = 'scan' | 'form' | 'queue';
type DraftSource = 'custom' | 'off' | 'manual' | null;

export default function AddItemsScreen() {
  const router = useRouter();
  const { warehouseId, boxId } = useLocalSearchParams<{
    warehouseId: string;
    boxId: string;
  }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<Mode>('scan');

  // Form for the product currently being scanned
  const [draft, setDraft] = useState<Partial<Draft> | null>(null);
  const [draftSource, setDraftSource] = useState<DraftSource>(null);
  const [looking, setLooking] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Queue of items waiting for the batch save
  const [queue, setQueue] = useState<Draft[]>([]);
  const [saving, setSaving] = useState(false);

  // Torch toggle
  const [torch, setTorch] = useState(false);

  // Toast shown after an item is added to the queue
  const [toast, setToast] = useState<string | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;

  // Debounce skeneru
  const lastBarcodeRef = useRef<string | null>(null);

  // --- Toast animace ---
  useEffect(() => {
    if (toast) {
      Animated.sequence([
        Animated.timing(toastOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.delay(1500),
        Animated.timing(toastOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setToast(null);
      });
    }
  }, [toast, toastOpacity]);

  // --------------------------------------------------------------
  // Scan handler – EAN z kamery
  // --------------------------------------------------------------
  const handleScan = async (barcode: string) => {
    if (looking || mode !== 'scan' || lastBarcodeRef.current === barcode) return;
    lastBarcodeRef.current = barcode;
    setLooking(true);
    try {
      if (!warehouseId) throw new Error('Missing warehouse context.');
      // 1. Local custom_products lookup
      const custom = await findCustomProduct(warehouseId, barcode);
      if (custom) {
        setDraft({
          name: custom.name,
          quantity: 1,
          unit: 'pcs',
          expiry_date: '',
          barcode,
          image_url: custom.image_url,
          category: custom.category,
          pack_count: null,
        });
        setDraftSource('custom');
        Haptics.selectionAsync();
        setMode('form');
        return;
      }

      // 2. Open Food Facts
      const off = await lookupByBarcode(barcode);
      if (off) {
        setDraft({
          name: off.name,
          quantity: 1,
          unit: 'pcs',
          expiry_date: '',
          barcode,
          image_url: off.image_url,
          category: off.category,
          pack_count: null,
        });
        setDraftSource('off');
        Haptics.selectionAsync();
        setMode('form');
        return;
      }

      // 3. Fallback — manual entry (OFF 404)
      setDraft({
        name: '',
        quantity: 1,
        unit: 'pcs',
        expiry_date: '',
        barcode,
        image_url: null,
        category: null,
        pack_count: null,
      });
      setDraftSource('manual');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setMode('form');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Cannot load product.');
      lastBarcodeRef.current = null;
    } finally {
      setLooking(false);
    }
  };

  // --------------------------------------------------------------
  // Manual add — no EAN
  // --------------------------------------------------------------
  const handleManual = () => {
    setDraft({
      name: '',
      quantity: 1,
      unit: 'pcs',
      expiry_date: '',
      barcode: null,
      image_url: null,
      category: null,
      pack_count: null,
    });
    setDraftSource('manual');
    setMode('form');
  };

  // --------------------------------------------------------------
  // "Same product, different date" — keep draft, clear expiry
  // --------------------------------------------------------------
  const handleSameAgain = (lastDraft: Draft) => {
    setDraft({
      ...lastDraft,
      localId: undefined,
      expiry_date: '',
    } as Partial<Draft>);
    setDraftSource(lastDraft.barcode ? 'custom' : 'manual');
    setMode('form');
  };

  // --------------------------------------------------------------
  // Add the current draft into the queue
  // --------------------------------------------------------------
  const handleAddToQueue = async () => {
    if (!draft) return;
    const { name, quantity, unit, expiry_date } = draft;
    if (!name?.trim()) {
      Alert.alert('Name required', 'Enter a product name.');
      return;
    }
    if (!quantity || quantity <= 0) {
      Alert.alert('Quantity required', 'Enter a positive quantity.');
      return;
    }
    if (!expiry_date || !/^\d{4}-\d{2}-\d{2}$/.test(expiry_date)) {
      Alert.alert('Expiry date required', 'Pick a date from the calendar.');
      return;
    }

    const entry: Draft = {
      localId: `${Date.now()}-${Math.random()}`,
      name: name.trim(),
      quantity,
      unit: unit ?? 'pcs',
      expiry_date,
      barcode: draft.barcode ?? null,
      image_url: draft.image_url ?? null,
      category: draft.category ?? null,
      pack_count: draft.pack_count ?? null,
    };
    setQueue((q) => [...q, entry]);

    // If it has a barcode and isn't already a custom_product, remember it
    if (entry.barcode && warehouseId) {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const userId = sess.session?.user.id;
        if (userId) {
          await upsertCustomProduct({
            warehouse_id: warehouseId,
            barcode: entry.barcode,
            name: entry.name,
            category: entry.category,
            image_url: entry.image_url,
            typical_expiry_days: null,
            created_by: userId,
          });
        }
      } catch {
        // Non-fatal, log silently
      }
    }

    // Haptic success + toast
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setToast(entry.name);

    // Reset, back to scan mode
    setDraft(null);
    setDraftSource(null);
    setShowDatePicker(false);
    lastBarcodeRef.current = null;
    setMode('scan');
  };

  const handleRemoveFromQueue = (localId: string) => {
    setQueue((q) => q.filter((x) => x.localId !== localId));
  };

  // --------------------------------------------------------------
  // Batch save
  // --------------------------------------------------------------
  const handleSaveAll = async () => {
    if (!boxId || queue.length === 0) return;
    try {
      setSaving(true);
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess.session?.user.id;
      if (!userId) throw new Error('Not signed in.');
      await addItemsBatch(
        boxId,
        userId,
        queue.map((d) => ({
          name: d.name,
          quantity: d.quantity,
          unit: d.unit,
          expiry_date: d.expiry_date,
          barcode: d.barcode,
          image_url: d.image_url,
          category: d.category,
          pack_count: d.pack_count,
        })),
      );
      router.replace(`/warehouse/${warehouseId}/box/${boxId}` as any);
    } catch (e: any) {
      Alert.alert('Save error', e?.message ?? 'Cannot save.');
    } finally {
      setSaving(false);
    }
  };

  // --------------------------------------------------------------
  // Render
  // --------------------------------------------------------------
  if (!permission) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Text style={styles.hint}>Preparing camera…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Icon brand="camera" size={96} style={styles.permIcon} />
          <Text style={styles.permTitle}>Camera access needed</Text>
          <Text style={styles.permText}>
            I need camera access to scan product barcodes.
          </Text>
          <Pressable style={styles.btnPrimary} onPress={requestPermission}>
            <Text style={styles.btnPrimaryText}>Allow camera</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnSecondary]} onPress={handleManual}>
            <Text style={styles.btnSecondaryText}>Add manually</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <Pressable
            hitSlop={12}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.topBarBtn, pressed && { opacity: 0.5 }]}
          >
            <Icon sf="chevron.left" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.topBarTitle}>Add items</Text>
          <View style={styles.topBarBtn} />
        </View>

      {mode === 'scan' && (
        <>
          <View style={styles.cameraWrap}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              enableTorch={torch}
              barcodeScannerSettings={{
                barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'],
              }}
              onBarcodeScanned={({ data }) => handleScan(data)}
            />
            {/* Torch toggle (top-right) */}
            <Pressable
              style={styles.torchBtn}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setTorch((t) => !t);
              }}
            >
              <Icon
                sf={torch ? 'flashlight.on.fill' : 'flashlight.off.fill'}
                size={24}
                color="#FFFFFF"
              />
            </Pressable>

            <View style={styles.scanOverlay} pointerEvents="none">
              <View style={styles.scanFrame} />
              <Text style={styles.scanText}>
                {looking ? 'Looking up product…' : 'Point at a barcode'}
              </Text>
            </View>
          </View>

          <View style={styles.scanActions}>
            <Pressable style={[styles.smallBtn, styles.btnSecondary]} onPress={handleManual}>
              <Text style={styles.btnSecondaryText}>Add manually</Text>
            </Pressable>
          </View>
        </>
      )}

      {mode === 'form' && draft && (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.formScroll} keyboardShouldPersistTaps="handled">
            {draft.image_url ? (
              <Image source={{ uri: draft.image_url }} style={styles.draftImage} />
            ) : (
              <View style={styles.draftImagePlaceholder}>
                <Icon
                  sf={draft.category ? CATEGORY_SF[draft.category] : 'shippingbox.fill'}
                  size={56}
                  color={colors.textMuted}
                />
              </View>
            )}

            <SourceBanner source={draftSource} barcode={draft.barcode ?? null} />

            <Text style={styles.label}>Name</Text>
            <TextInput
              value={draft.name ?? ''}
              onChangeText={(v) => setDraft({ ...draft, name: v })}
              placeholder="Product name"
              placeholderTextColor={colors.textSubtle}
              style={styles.input}
            />

            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Quantity</Text>
                <TextInput
                  value={draft.quantity?.toString() ?? ''}
                  onChangeText={(v) =>
                    setDraft({ ...draft, quantity: parseFloat(v.replace(',', '.')) || 0 })
                  }
                  keyboardType="decimal-pad"
                  style={styles.input}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Unit</Text>
                <ChipRow
                  options={UNITS}
                  value={draft.unit ?? 'pcs'}
                  onChange={(u) => u && setDraft({ ...draft, unit: u })}
                />
              </View>
            </View>

            <Text style={styles.label}>Pcs per package (optional)</Text>
            <TextInput
              value={draft.pack_count != null ? String(draft.pack_count) : ''}
              onChangeText={(v) => {
                const trimmed = v.trim();
                if (!trimmed) {
                  setDraft({ ...draft, pack_count: null });
                  return;
                }
                const parsed = parseInt(trimmed, 10);
                setDraft({
                  ...draft,
                  pack_count: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
                });
              }}
              placeholder="e.g. 24"
              placeholderTextColor={colors.textSubtle}
              keyboardType="number-pad"
              style={styles.input}
            />

            <Text style={styles.label}>Expiry date</Text>
            <Pressable
              style={[styles.input, styles.dateField]}
              onPress={() => setShowDatePicker((s) => !s)}
            >
              <Text style={[styles.dateText, !draft.expiry_date && styles.datePlaceholder]}>
                {draft.expiry_date ? formatDate(draft.expiry_date) : 'Pick a date'}
              </Text>
              <Icon
                sf={showDatePicker ? 'chevron.up' : 'chevron.down'}
                size={14}
                color={colors.textMuted}
              />
            </Pressable>
            {showDatePicker && (
              <View style={styles.datePickerWrap}>
                <DateTimePicker
                  value={fromIsoDate(draft.expiry_date ?? '') ?? new Date()}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'inline' : 'default'}
                  minimumDate={new Date(2000, 0, 1)}
                  locale="en-GB"
                  onChange={(event: DateTimePickerEvent, selected?: Date) => {
                    // Android: close on any event. iOS inline: only update state.
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
              value={draft.category ?? null}
              onChange={(c) => setDraft({ ...draft, category: c })}
              renderLabel={(c) => c}
              allowNull
            />

            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={handleAddToQueue}>
              <View style={styles.btnContent}>
                <Icon sf="plus" size={18} color={colors.textOnPrimary} />
                <Text style={styles.btnPrimaryText}>Add to queue</Text>
              </View>
            </Pressable>

            <Pressable
              style={[styles.btn, styles.btnSecondary]}
              onPress={() => {
                setDraft(null);
                setDraftSource(null);
                setShowDatePicker(false);
                lastBarcodeRef.current = null;
                setMode('scan');
              }}
            >
              <Text style={styles.btnSecondaryText}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* Queue — always pinned below content */}
      {queue.length > 0 && mode === 'scan' && (
        <View style={styles.queueContainer}>
          <View style={styles.queueHeader}>
            <Text style={styles.queueTitle}>Queue ({queue.length})</Text>
            <Pressable onPress={handleSaveAll} disabled={saving}>
              <Text style={[styles.saveAllText, saving && { opacity: 0.5 }]}>
                {saving ? 'Saving…' : 'Save all'}
              </Text>
            </Pressable>
          </View>
          <FlatList
            data={queue}
            keyExtractor={(item) => item.localId}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.queueList}
            renderItem={({ item }) => (
              <QueueChip
                draft={item}
                onRemove={() => handleRemoveFromQueue(item.localId)}
                onSameAgain={() => handleSameAgain(item)}
              />
            )}
          />
        </View>
      )}

      {saving && (
        <View style={styles.savingOverlay}>
          <ActivityIndicator color="#FFFFFF" size="large" />
          <Text style={styles.savingText}>Saving {queue.length} items…</Text>
        </View>
      )}

      {/* Toast: ✓ Added */}
      {toast && (
        <Animated.View style={[styles.toast, { opacity: toastOpacity }]} pointerEvents="none">
          <Icon sf="checkmark.circle.fill" size={16} color={colors.textOnPrimary} />
          <Text style={styles.toastText} numberOfLines={1}>
            Added: {toast}
          </Text>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// SourceBanner — shows where the current draft came from
// ---------------------------------------------------------------------------

function SourceBanner({
  source,
  barcode,
}: {
  source: DraftSource;
  barcode: string | null;
}) {
  if (!source) return null;
  if (source === 'custom') {
    return (
      <View style={[styles.sourceBanner, styles.sourceCustom]}>
        <Icon sf="checkmark.circle.fill" size={16} color={colors.successText} />
        <Text style={[styles.sourceText, { color: colors.successText }]}>
          Previously added product — fill quantity and date
        </Text>
      </View>
    );
  }
  if (source === 'off') {
    return (
      <View style={[styles.sourceBanner, styles.sourceOff]}>
        <Icon sf="checkmark.circle.fill" size={16} color={colors.infoText} />
        <Text style={[styles.sourceText, { color: colors.infoText }]}>
          Loaded from Open Food Facts — verify and add a date
        </Text>
      </View>
    );
  }
  // manual
  return (
    <View style={[styles.sourceBanner, styles.sourceManual]}>
      <Icon sf="exclamationmark.triangle.fill" size={16} color={colors.warningText} />
      <Text style={[styles.sourceText, { color: colors.warningText }]}>
        {barcode
          ? `Product ${barcode} not in database — fill in manually`
          : 'Manual entry'}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ChipRow – generic selector s emoji labels
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
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
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

// ---------------------------------------------------------------------------
// QueueChip — a card shown in the queue
// ---------------------------------------------------------------------------

function QueueChip({
  draft,
  onRemove,
  onSameAgain,
}: {
  draft: Draft;
  onRemove: () => void;
  onSameAgain: () => void;
}) {
  const status = getExpiryStatus(draft.expiry_date);
  const palette =
    status === 'none'
      ? { bg: colors.expiryNoneBg, fg: colors.expiryNoneText }
      : EXPIRY_COLORS[status];
  return (
    <View style={styles.queueChip}>
      <Pressable onPress={onRemove} style={styles.queueRemove}>
        <Icon sf="xmark" size={12} color="#FFFFFF" />
      </Pressable>
      {draft.image_url ? (
        <Image source={{ uri: draft.image_url }} style={styles.queueImage} />
      ) : (
        <Icon
          sf={draft.category ? CATEGORY_SF[draft.category] : 'shippingbox.fill'}
          size={34}
          color={colors.textMuted}
        />
      )}
      <Text numberOfLines={2} style={styles.queueName}>
        {draft.name}
      </Text>
      <Text style={styles.queueQty}>{formatItemQuantity(draft)}</Text>
      <View style={[styles.queueBadge, { backgroundColor: palette.bg }]}>
        <Text style={[styles.queueBadgeText, { color: palette.fg }]}>
          {formatExpiry(draft.expiry_date)}
        </Text>
      </View>
      <Pressable onPress={onSameAgain} style={styles.queueAgainBtn}>
        <View style={styles.queueAgainContent}>
          <Icon sf="arrow.clockwise" size={10} color={colors.text} />
          <Text style={styles.queueAgainText}>Different date</Text>
        </View>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  topBarBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    ...typography.headline,
    color: colors.text,
    flex: 1,
    textAlign: 'center',
    marginHorizontal: spacing.sm,
  },
  center: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
  },
  hint: {
    ...typography.subhead,
    color: colors.textMuted,
  },
  permIcon: { marginBottom: spacing.lg },
  permTitle: {
    ...typography.title2,
    color: colors.text,
    marginBottom: spacing.md,
  },
  permText: {
    ...typography.subhead,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  // Scanner
  cameraWrap: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanFrame: {
    width: 280,
    height: 140,
    borderRadius: radius.md,
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  scanText: {
    ...typography.subhead,
    color: '#FFFFFF',
    fontWeight: '600',
    marginTop: spacing.lg,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
  },
  scanActions: {
    flexDirection: 'row',
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: '#000',
  },
  smallBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  // Form
  formScroll: { padding: spacing.lg, gap: spacing.xs },
  draftImage: {
    width: 120,
    height: 120,
    borderRadius: radius.md,
    alignSelf: 'center',
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    resizeMode: 'contain',
  },
  draftImagePlaceholder: {
    width: 120,
    height: 120,
    borderRadius: radius.md,
    alignSelf: 'center',
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
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
  datePickerWrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', gap: spacing.md },
  btn: {
    marginTop: spacing.lg,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  btnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryText: {
    ...typography.bodyStrong,
    color: colors.textOnPrimary,
  },
  btnSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnSecondaryText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
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
  // Queue
  queueContainer: {
    backgroundColor: colors.surfaceElevated,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  queueHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
  },
  queueTitle: {
    ...typography.footnote,
    color: colors.text,
    fontWeight: '700',
  },
  saveAllText: {
    ...typography.footnote,
    color: colors.primary,
    fontWeight: '700',
  },
  queueList: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  queueChip: {
    width: 140,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    alignItems: 'center',
  },
  queueRemove: {
    position: 'absolute',
    top: 2,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  queueImage: { width: 50, height: 50, borderRadius: radius.sm + 2, resizeMode: 'contain' },
  queueName: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginTop: 4,
  },
  queueQty: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 1,
  },
  queueBadge: {
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  queueBadgeText: { fontSize: 9, fontWeight: '700' },
  queueAgainBtn: {
    marginTop: 6,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  queueAgainContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  queueAgainText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.text,
  },
  savingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.scrim,
    justifyContent: 'center',
    alignItems: 'center',
  },
  savingText: {
    ...typography.subhead,
    color: '#FFFFFF',
    marginTop: spacing.md,
    fontWeight: '600',
  },

  // Torch
  torchBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Toast
  toast: {
    position: 'absolute',
    top: 60,
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  toastText: {
    ...typography.footnote,
    color: colors.textOnPrimary,
    fontWeight: '700',
  },

  // Source banner (J)
  sourceBanner: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  sourceCustom: {
    backgroundColor: colors.successBg,
    borderColor: colors.successBgStrong,
  },
  sourceOff: {
    backgroundColor: colors.infoBg,
    borderColor: colors.infoBg,
  },
  sourceManual: {
    backgroundColor: colors.warningBg,
    borderColor: colors.warningBgStrong,
  },
  sourceText: {
    ...typography.footnote,
    fontWeight: '600',
    flex: 1,
  },
});
