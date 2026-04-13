// ============================================================================
// Stockr – Naskladňovací batch session
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
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import {
  addItemsBatch,
  findCustomProduct,
  getMyWarehouse,
  supabase,
  upsertCustomProduct,
} from '@/src/lib/supabase';
import { lookupByBarcode } from '@/src/lib/openFoodFacts';
import {
  CATEGORIES,
  CATEGORY_EMOJI,
  EXPIRY_COLORS,
  UNITS,
  formatDateCs,
  formatExpiry,
  fromIsoDate,
  getExpiryStatus,
  toIsoDate,
} from '@/src/types/database';
import type { Category, Unit } from '@/src/types/database';

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
}

type Mode = 'scan' | 'form' | 'queue';
type DraftSource = 'custom' | 'off' | 'manual' | null;

export default function AddItemsScreen() {
  const router = useRouter();
  const { id: boxId } = useLocalSearchParams<{ id: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<Mode>('scan');

  // Forma pro aktuálně skenovaný produkt
  const [draft, setDraft] = useState<Partial<Draft> | null>(null);
  const [draftSource, setDraftSource] = useState<DraftSource>(null);
  const [looking, setLooking] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Fronta položek čekajících na batch save
  const [queue, setQueue] = useState<Draft[]>([]);
  const [saving, setSaving] = useState(false);

  // Svítilna (torch)
  const [torch, setTorch] = useState(false);

  // Toast po přidání do fronty
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
      // 1. Lokální custom_products
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess.session?.user.id;
      if (!userId) throw new Error('Nejsi přihlášen.');
      const wh = await getMyWarehouse(userId);
      if (!wh) throw new Error('Chybí sklad.');

      const custom = await findCustomProduct(wh.id, barcode);
      if (custom) {
        setDraft({
          name: custom.name,
          quantity: 1,
          unit: 'ks',
          expiry_date: '',
          barcode,
          image_url: custom.image_url,
          category: custom.category,
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
          unit: 'ks',
          expiry_date: '',
          barcode,
          image_url: off.image_url,
          category: off.category,
        });
        setDraftSource('off');
        Haptics.selectionAsync();
        setMode('form');
        return;
      }

      // 3. Fallback – ruční zadání (OFF 404)
      setDraft({
        name: '',
        quantity: 1,
        unit: 'ks',
        expiry_date: '',
        barcode,
        image_url: null,
        category: null,
      });
      setDraftSource('manual');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setMode('form');
    } catch (e: any) {
      Alert.alert('Chyba', e?.message ?? 'Nelze načíst produkt.');
      lastBarcodeRef.current = null;
    } finally {
      setLooking(false);
    }
  };

  // --------------------------------------------------------------
  // Manuální přidání – bez EAN
  // --------------------------------------------------------------
  const handleManual = () => {
    setDraft({
      name: '',
      quantity: 1,
      unit: 'ks',
      expiry_date: '',
      barcode: null,
      image_url: null,
      category: null,
    });
    setDraftSource('manual');
    setMode('form');
  };

  // --------------------------------------------------------------
  // „Stejné, jiné datum" – zachovat aktuální draft, vyčistit datum
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
  // Přidání draftu do fronty
  // --------------------------------------------------------------
  const handleAddToQueue = async () => {
    if (!draft) return;
    const { name, quantity, unit, expiry_date } = draft;
    if (!name?.trim()) {
      Alert.alert('Chybí název', 'Zadej název produktu.');
      return;
    }
    if (!quantity || quantity <= 0) {
      Alert.alert('Chybí množství', 'Zadej kladné množství.');
      return;
    }
    if (!expiry_date || !/^\d{4}-\d{2}-\d{2}$/.test(expiry_date)) {
      Alert.alert('Chybí datum expirace', 'Vyber datum pomocí kalendáře.');
      return;
    }

    const entry: Draft = {
      localId: `${Date.now()}-${Math.random()}`,
      name: name.trim(),
      quantity,
      unit: unit ?? 'ks',
      expiry_date,
      barcode: draft.barcode ?? null,
      image_url: draft.image_url ?? null,
      category: draft.category ?? null,
    };
    setQueue((q) => [...q, entry]);

    // Pokud má barcode a custom_product to není, zapamatuj si pro příště
    if (entry.barcode) {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const userId = sess.session?.user.id;
        if (userId) {
          const wh = await getMyWarehouse(userId);
          if (wh) {
            await upsertCustomProduct({
              warehouse_id: wh.id,
              barcode: entry.barcode,
              name: entry.name,
              category: entry.category,
              image_url: entry.image_url,
              typical_expiry_days: null,
              created_by: userId,
            });
          }
        }
      } catch {
        // Non-fatal, logujeme tiše
      }
    }

    // Haptic success + toast
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setToast(entry.name);

    // Reset, zpět na scan
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
      if (!userId) throw new Error('Nejsi přihlášen.');
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
        })),
      );
      router.replace(`/box/${boxId}` as any);
    } catch (e: any) {
      Alert.alert('Chyba ukládání', e?.message ?? 'Nelze uložit.');
    } finally {
      setSaving(false);
    }
  };

  // --------------------------------------------------------------
  // Render
  // --------------------------------------------------------------
  if (!permission) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.hint}>Připravuji kameru…</Text>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.center}>
        <Stack.Screen options={{ title: 'Naskladnit' }} />
        <Text style={styles.permTitle}>Potřebuju kameru</Text>
        <Text style={styles.permText}>
          Pro skenování čárových kódů produktů potřebuji přístup k fotoaparátu.
        </Text>
        <Pressable style={styles.btnPrimary} onPress={requestPermission}>
          <Text style={styles.btnPrimaryText}>Povolit kameru</Text>
        </Pressable>
        <Pressable style={[styles.btn, styles.btnSecondary]} onPress={handleManual}>
          <Text style={styles.btnSecondaryText}>Přidat ručně</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Naskladnit' }} />

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
              <Text style={styles.torchIcon}>{torch ? '🔦' : '💡'}</Text>
            </Pressable>

            <View style={styles.scanOverlay} pointerEvents="none">
              <View style={styles.scanFrame} />
              <Text style={styles.scanText}>
                {looking ? 'Hledám produkt…' : 'Zamiř na čárový kód'}
              </Text>
            </View>
          </View>

          <View style={styles.scanActions}>
            <Pressable style={[styles.smallBtn, styles.btnSecondary]} onPress={handleManual}>
              <Text style={styles.btnSecondaryText}>Přidat ručně</Text>
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
                <Text style={{ fontSize: 56 }}>
                  {draft.category ? CATEGORY_EMOJI[draft.category] : '📦'}
                </Text>
              </View>
            )}

            <SourceBanner source={draftSource} barcode={draft.barcode ?? null} />

            <Text style={styles.label}>Název</Text>
            <TextInput
              value={draft.name ?? ''}
              onChangeText={(v) => setDraft({ ...draft, name: v })}
              placeholder="Název produktu"
              placeholderTextColor="#B0B0B0"
              style={styles.input}
            />

            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Množství</Text>
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
                <Text style={styles.label}>Jednotka</Text>
                <ChipRow
                  options={UNITS}
                  value={draft.unit ?? 'ks'}
                  onChange={(u) => u && setDraft({ ...draft, unit: u })}
                />
              </View>
            </View>

            <Text style={styles.label}>Datum expirace</Text>
            <Pressable
              style={[styles.input, styles.dateField]}
              onPress={() => setShowDatePicker((s) => !s)}
            >
              <Text style={[styles.dateText, !draft.expiry_date && styles.datePlaceholder]}>
                {draft.expiry_date ? formatDateCs(draft.expiry_date) : 'Vyber datum'}
              </Text>
              <Text style={styles.dateChevron}>{showDatePicker ? '▴' : '▾'}</Text>
            </Pressable>
            {showDatePicker && (
              <View style={styles.datePickerWrap}>
                <DateTimePicker
                  value={fromIsoDate(draft.expiry_date ?? '') ?? new Date()}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'inline' : 'default'}
                  minimumDate={new Date(2000, 0, 1)}
                  locale="cs-CZ"
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

            <Text style={styles.label}>Kategorie</Text>
            <ChipRow
              options={CATEGORIES}
              value={draft.category ?? null}
              onChange={(c) => setDraft({ ...draft, category: c })}
              renderLabel={(c) => `${CATEGORY_EMOJI[c]} ${c}`}
              allowNull
            />

            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={handleAddToQueue}>
              <Text style={styles.btnPrimaryText}>+ Přidat do fronty</Text>
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
              <Text style={styles.btnSecondaryText}>Zrušit</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* Fronta – vždy pod obsahem */}
      {queue.length > 0 && mode === 'scan' && (
        <View style={styles.queueContainer}>
          <View style={styles.queueHeader}>
            <Text style={styles.queueTitle}>Fronta ({queue.length})</Text>
            <Pressable onPress={handleSaveAll} disabled={saving}>
              <Text style={[styles.saveAllText, saving && { opacity: 0.5 }]}>
                {saving ? 'Ukládám…' : 'Uložit vše'}
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
          <ActivityIndicator color="#fff" size="large" />
          <Text style={styles.savingText}>Ukládám {queue.length} položek…</Text>
        </View>
      )}

      {/* Toast: ✓ Přidáno */}
      {toast && (
        <Animated.View style={[styles.toast, { opacity: toastOpacity }]} pointerEvents="none">
          <Text style={styles.toastText} numberOfLines={1}>
            ✓ Přidáno: {toast}
          </Text>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// SourceBanner – J: info odkud draft pochází
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
        <Text style={[styles.sourceText, { color: '#27500A' }]}>
          ✓ Dříve přidaný produkt — doplň množství a datum
        </Text>
      </View>
    );
  }
  if (source === 'off') {
    return (
      <View style={[styles.sourceBanner, styles.sourceOff]}>
        <Text style={[styles.sourceText, { color: '#0B4F6C' }]}>
          ✓ Načteno z Open Food Facts — zkontroluj a doplň datum
        </Text>
      </View>
    );
  }
  // manual
  return (
    <View style={[styles.sourceBanner, styles.sourceManual]}>
      <Text style={[styles.sourceText, { color: '#633806' }]}>
        {barcode
          ? `⚠️ Produkt ${barcode} není v databázi — vyplň ručně`
          : 'Ruční zadání'}
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
// QueueChip – karta ve frontě
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
  const palette = status === 'none' ? { bg: '#EFEFEF', fg: '#666' } : EXPIRY_COLORS[status];
  return (
    <View style={styles.queueChip}>
      <Pressable onPress={onRemove} style={styles.queueRemove}>
        <Text style={styles.queueRemoveText}>×</Text>
      </Pressable>
      {draft.image_url ? (
        <Image source={{ uri: draft.image_url }} style={styles.queueImage} />
      ) : (
        <Text style={styles.queueEmoji}>
          {draft.category ? CATEGORY_EMOJI[draft.category] : '📦'}
        </Text>
      )}
      <Text numberOfLines={2} style={styles.queueName}>
        {draft.name}
      </Text>
      <Text style={styles.queueQty}>
        {Number.isInteger(draft.quantity) ? draft.quantity : draft.quantity.toFixed(1)} {draft.unit}
      </Text>
      <View style={[styles.queueBadge, { backgroundColor: palette.bg }]}>
        <Text style={[styles.queueBadgeText, { color: palette.fg }]}>
          {formatExpiry(draft.expiry_date)}
        </Text>
      </View>
      <Pressable onPress={onSameAgain} style={styles.queueAgainBtn}>
        <Text style={styles.queueAgainText}>↻ Jiné datum</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F7' },
  center: {
    flex: 1,
    backgroundColor: '#F5F5F7',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  hint: { color: '#666' },
  permTitle: { fontSize: 22, fontWeight: '700', color: '#111', marginBottom: 12 },
  permText: { color: '#666', textAlign: 'center', marginBottom: 24, lineHeight: 20 },
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
    borderRadius: 12,
    borderWidth: 3,
    borderColor: '#fff',
  },
  scanText: {
    color: '#fff',
    fontWeight: '600',
    marginTop: 20,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
  },
  scanActions: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
    backgroundColor: '#000',
  },
  smallBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  // Form
  formScroll: { padding: 16, gap: 4 },
  draftImage: {
    width: 120,
    height: 120,
    borderRadius: 12,
    alignSelf: 'center',
    marginBottom: 8,
    backgroundColor: '#fff',
    resizeMode: 'contain',
  },
  draftImagePlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 12,
    alignSelf: 'center',
    marginBottom: 8,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginTop: 12,
    marginBottom: 4,
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
  dateField: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
  },
  dateText: { fontSize: 16, color: '#111', fontWeight: '500' },
  datePlaceholder: { color: '#B0B0B0', fontWeight: '400' },
  dateChevron: { fontSize: 16, color: '#666' },
  datePickerWrap: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#E5E5E7',
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', gap: 12 },
  btn: {
    marginTop: 16,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnPrimary: { backgroundColor: '#111' },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  btnSecondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#E0E0E0' },
  btnSecondaryText: { color: '#111', fontWeight: '600', fontSize: 16 },
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
  // Queue
  queueContainer: {
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E5E7',
    paddingTop: 8,
  },
  queueHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  queueTitle: { fontSize: 14, fontWeight: '700', color: '#111' },
  saveAllText: { fontSize: 14, fontWeight: '700', color: '#007AFF' },
  queueList: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  queueChip: {
    width: 140,
    backgroundColor: '#F5F5F7',
    borderRadius: 12,
    padding: 8,
    alignItems: 'center',
  },
  queueRemove: {
    position: 'absolute',
    top: 2,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  queueRemoveText: { color: '#fff', fontSize: 16, lineHeight: 18 },
  queueImage: { width: 50, height: 50, borderRadius: 8, resizeMode: 'contain' },
  queueEmoji: { fontSize: 36, marginVertical: 4 },
  queueName: { fontSize: 11, fontWeight: '600', color: '#111', textAlign: 'center', marginTop: 4 },
  queueQty: { fontSize: 10, color: '#666', marginTop: 1 },
  queueBadge: {
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  queueBadgeText: { fontSize: 9, fontWeight: '700' },
  queueAgainBtn: {
    marginTop: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E5E7',
  },
  queueAgainText: { fontSize: 10, fontWeight: '600', color: '#111' },
  savingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  savingText: { color: '#fff', marginTop: 12, fontWeight: '600' },

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
  torchIcon: { fontSize: 22 },

  // Toast
  toast: {
    position: 'absolute',
    top: 60,
    left: 16,
    right: 16,
    backgroundColor: '#27500A',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  toastText: { color: '#fff', fontWeight: '700', fontSize: 14, textAlign: 'center' },

  // Source banner (J)
  sourceBanner: {
    alignSelf: 'stretch',
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  sourceCustom: { backgroundColor: '#EAF3DE' },
  sourceOff: { backgroundColor: '#DCEEF5' },
  sourceManual: { backgroundColor: '#FAEEDA' },
  sourceText: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
});
