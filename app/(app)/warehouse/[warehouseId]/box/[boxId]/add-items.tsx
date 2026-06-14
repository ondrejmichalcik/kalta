// ============================================================================
// Kalta – Add items (batch session)
// Flow: EAN scan → OFF lookup → form → queue → save all
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
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
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Swipeable } from 'react-native-gesture-handler';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { getCachedUri } from '@/src/lib/imageCache';
// Aliased to avoid colliding with the local `toast` queue-add state below.
import { toast as appToast } from '@/src/lib/feedback';
import {
  addOrMergeItem,
  deleteShoppingItem,
  findCustomProduct,
  getActiveUserId,
  setCustomProductMinQuantity,
  supabase,
  upsertCustomProduct,
} from '@/src/lib/supabase';
import { deleteProductImage, uploadProductImage } from '@/src/lib/storage';
import {
  formatShelfLife,
  hasAnthropicKey,
  identifyProduct,
  MissingApiKeyError,
} from '@/src/lib/vision';
import { lookupByBarcode } from '@/src/lib/openFoodFacts';
import {
  CATEGORIES,
  EXPIRY_COLORS,
  NEVER_EXPIRES_DATE,
  UNITS,
  formatDate,
  formatExpiry,
  formatItemQuantity,
  fromIsoDate,
  getExpiryStatus,
  isNeverExpires,
  toIsoDate,
} from '@/src/types/database';
import type { Category, Unit } from '@/src/types/database';
import { colors, radius, shadows, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';
import { CategoryPickerSheet, CategoryPickerTrigger } from '@/src/components/CategoryPickerSheet';
import { CATEGORY_SF } from '@/src/components/categoryIcons';

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
  energy_kcal_per_100g: number | null;
  net_weight_g: number | null;
  min_quantity: number | null;
}

type Mode = 'scan' | 'form' | 'queue';
type DraftSource = 'custom' | 'off' | 'manual' | null;

/** Parse a free-text numeric field into a positive number, else null. */
function parsePositiveNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const n = parseFloat(trimmed.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default function AddItemsScreen() {
  const router = useRouter();
  const { warehouseId, boxId, prefillName, prefillCategory, shoppingItemId } =
    useLocalSearchParams<{
      warehouseId: string;
      boxId: string;
      prefillName?: string;
      prefillCategory?: string;
      shoppingItemId?: string;
    }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<Mode>('scan');
  // When arriving from the shopping list "restock" flow, clear that row once
  // items are actually saved into a box.
  const shoppingItemIdRef = useRef<string | null>(shoppingItemId ?? null);
  const prefilledRef = useRef(false);

  // Form for the product currently being scanned
  const [draft, setDraft] = useState<Partial<Draft> | null>(null);
  const [draftSource, setDraftSource] = useState<DraftSource>(null);
  const [looking, setLooking] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  // Progressive disclosure: nutrition + low-stock fields live under one tap.
  // EAN scans auto-fill them in the background, so the typical add doesn't
  // need them visible at all.
  const [showMoreDetails, setShowMoreDetails] = useState(false);

  // Queue of items waiting for the batch save
  const [queue, setQueue] = useState<Draft[]>([]);
  const [saving, setSaving] = useState(false);

  // Torch toggle
  const [torch, setTorch] = useState(false);

  // Image upload state — blocks Save while a picked photo is still uploading
  const [uploadingImage, setUploadingImage] = useState(false);

  // Claude Vision state: gate UI by key presence + track in-flight identify
  // calls + surface a shelf-life hint below the expiry picker when Claude
  // suggested one.
  const [visionEnabled, setVisionEnabled] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const [shelfLifeDaysHint, setShelfLifeDaysHint] = useState<number | null>(null);

  // Re-probe API key on every focus — user might return from Profile
  // after setting/removing a key mid-session.
  useFocusEffect(
    useCallback(() => {
      hasAnthropicKey().then(setVisionEnabled).catch(() => {});
    }, []),
  );

  // Restock prefill (from the shopping list) — open straight into a manual
  // form draft seeded with the purchased product's name + category.
  useEffect(() => {
    if (prefilledRef.current || !prefillName) return;
    prefilledRef.current = true;
    const cat =
      prefillCategory && (CATEGORIES as readonly string[]).includes(prefillCategory)
        ? (prefillCategory as Category)
        : null;
    setDraft({
      name: prefillName,
      quantity: 1,
      unit: 'pcs',
      expiry_date: '',
      barcode: null,
      image_url: null,
      category: cat,
      pack_count: null,
      energy_kcal_per_100g: null,
      net_weight_g: null,
      min_quantity: null,
    });
    setDraftSource('manual');
    setMode('form');
  }, [prefillName, prefillCategory]);

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
          energy_kcal_per_100g: null,
          net_weight_g: null,
          min_quantity: custom.min_quantity ?? null,
        });
        setDraftSource('custom');
        // Surface the cached Claude shelf-life hint (if any) so the user
        // gets the same context as on first identification.
        setShelfLifeDaysHint(custom.typical_expiry_days);
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
          energy_kcal_per_100g: off.energy_kcal_per_100g,
          net_weight_g: off.net_weight_g,
          min_quantity: null,
        });
        setDraftSource('off');
        setShelfLifeDaysHint(null);
        Haptics.selectionAsync();
        setMode('form');
        return;
      }

      // 3. Not in OFF (404 / status 0) → go straight to manual entry with the
      // barcode prefilled. No interrupting alert — the SourceBanner already
      // says "Product <barcode> not in database — fill in manually", and the
      // "Identify with AI" button stays available in the form for opt-in vision.
      openManualDraftForBarcode(barcode);
    } catch (e: any) {
      // Network / OFF error — same graceful fallback to manual (with the
      // barcode), no alert and (critically) WITHOUT resetting lastBarcodeRef,
      // so the camera doesn't re-fire the same barcode into a lookup loop.
      openManualDraftForBarcode(barcode);
    } finally {
      setLooking(false);
    }
  };

  // Open the manual draft form seeded with just the scanned barcode.
  const openManualDraftForBarcode = (barcode: string) => {
    setDraft({
      name: '',
      quantity: 1,
      unit: 'pcs',
      expiry_date: '',
      barcode,
      image_url: null,
      category: null,
      pack_count: null,
      energy_kcal_per_100g: null,
      net_weight_g: null,
      min_quantity: null,
    });
    setDraftSource('manual');
    setShelfLifeDaysHint(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    setMode('form');
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
      energy_kcal_per_100g: null,
      net_weight_g: null,
      min_quantity: null,
    });
    setDraftSource('manual');
    setShelfLifeDaysHint(null);
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
  // Image picker — attach a photo to the draft before adding to queue
  // --------------------------------------------------------------
  const runImageUpload = async (localUri: string) => {
    if (!warehouseId || !draft) return;
    try {
      setUploadingImage(true);
      const previousUrl = draft.image_url ?? null;
      const newUrl = await uploadProductImage(warehouseId, localUri);
      setDraft((d) => (d ? { ...d, image_url: newUrl } : d));
      // Fire-and-forget: if the previous URL was one we uploaded this
      // session, clean it up. `deleteProductImage` safely no-ops on
      // external URLs (OFF thumbnails, custom_products cached URLs).
      if (previousUrl) {
        deleteProductImage(previousUrl).catch(() => {});
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) {
      appToast.error(e?.message ?? 'Cannot upload image.');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleTakePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      appToast.error('Enable camera access in iOS Settings.');
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
      appToast.error('Enable photo library access in iOS Settings.');
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
    if (!draft) return;
    const current = draft.image_url ?? null;
    setDraft((d) => (d ? { ...d, image_url: null } : d));
    if (current) {
      deleteProductImage(current).catch(() => {});
    }
  };

  // --------------------------------------------------------------
  // Claude Vision — identify from image
  // --------------------------------------------------------------

  /** Shared post-identify handler: merges result into the draft, sets the
   *  shelf-life hint, and caches the product for future scans. */
  const applyIdentifyResult = async (
    result: { name: string; category: Category; typical_shelf_life_days: number },
    opts: { barcode: string | null; imageUrl: string },
  ) => {
    setDraft((d) => {
      if (!d) return d;
      return {
        ...d,
        name: result.name,
        category: result.category,
        image_url: opts.imageUrl,
      };
    });
    setShelfLifeDaysHint(result.typical_shelf_life_days);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

    // Cache to custom_products so the next scan of the same barcode
    // prefills without another Claude call.
    if (opts.barcode && warehouseId) {
      try {
        const userId = await getActiveUserId();
        if (userId) {
          await upsertCustomProduct({
            warehouse_id: warehouseId,
            barcode: opts.barcode,
            name: result.name,
            category: result.category,
            image_url: opts.imageUrl,
            typical_expiry_days: result.typical_shelf_life_days,
            created_by: userId,
          });
        }
      } catch {
        // Non-fatal
      }
    }
  };

  /** Path B: user has a photo on the draft and taps "Identify with AI"
   *  button to (re-)identify. Uses the existing image_url, no new upload. */
  const handleIdentifyAI = async () => {
    if (!draft?.image_url) return;
    try {
      setIdentifying(true);
      const result = await identifyProduct(draft.image_url);
      await applyIdentifyResult(result, {
        barcode: draft.barcode ?? null,
        imageUrl: draft.image_url,
      });
    } catch (e: any) {
      if (e instanceof MissingApiKeyError) {
        appToast.error(e.message);
      } else {
        appToast.error(e?.message ?? 'Unknown error.');
      }
    } finally {
      setIdentifying(false);
    }
  };

  /** No photo yet: pick/take one, upload, then identify in one flow. Lets the
   *  user reach AI identification straight from the manual form (e.g. after an
   *  unknown-barcode scan) without first manually attaching a photo. */
  const identifyWithNewPhoto = () => {
    if (!warehouseId || !draft || uploadingImage || identifying) return;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'Identify with AI',
        message: 'Take or choose a photo — AI will suggest the name and category.',
        options: ['Take photo', 'Choose from library', 'Cancel'],
        cancelButtonIndex: 2,
      },
      async (idx) => {
        if (idx == null || idx > 1) return;
        try {
          let uri: string | null = null;
          if (idx === 0) {
            const perm = await ImagePicker.requestCameraPermissionsAsync();
            if (!perm.granted) {
              appToast.error('Enable camera access in iOS Settings.');
              return;
            }
            const r = await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 1, mediaTypes: ['images'] });
            if (r.canceled || !r.assets[0]) return;
            uri = r.assets[0].uri;
          } else {
            const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!perm.granted) {
              appToast.error('Enable photo library access in iOS Settings.');
              return;
            }
            const r = await ImagePicker.launchImageLibraryAsync({ allowsEditing: false, quality: 1, mediaTypes: ['images'] });
            if (r.canceled || !r.assets[0]) return;
            uri = r.assets[0].uri;
          }
          setUploadingImage(true);
          const url = await uploadProductImage(warehouseId, uri);
          setDraft((d) => (d ? { ...d, image_url: url } : d));
          setUploadingImage(false);
          setIdentifying(true);
          const result = await identifyProduct(url);
          await applyIdentifyResult(result, { barcode: draft.barcode ?? null, imageUrl: url });
        } catch (e: any) {
          if (e instanceof MissingApiKeyError) appToast.error(e.message);
          else appToast.error(e?.message ?? 'Unknown error.');
        } finally {
          setUploadingImage(false);
          setIdentifying(false);
        }
      },
    );
  };

  const showImagePicker = () => {
    if (uploadingImage || !draft) return;
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

  // --------------------------------------------------------------
  // Add the current draft into the queue
  // --------------------------------------------------------------
  const handleAddToQueue = async () => {
    if (!draft) return;
    if (uploadingImage) {
      appToast.info('Please wait for the photo upload to finish.');
      return;
    }
    const { name, quantity, unit, expiry_date } = draft;
    if (!name?.trim()) {
      appToast.error('Enter a product name.');
      return;
    }
    if (!quantity || quantity <= 0) {
      appToast.error('Enter a positive quantity.');
      return;
    }
    // expiry_date may be either a YYYY-MM-DD picked from the calendar or the
    // sentinel NEVER_EXPIRES_DATE when the user toggled "Never expires".
    if (!expiry_date || !/^\d{4}-\d{2}-\d{2}$/.test(expiry_date)) {
      appToast.error('Pick a date or choose "Never expires".');
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
      energy_kcal_per_100g: draft.energy_kcal_per_100g ?? null,
      net_weight_g: draft.net_weight_g ?? null,
      min_quantity: draft.min_quantity ?? null,
    };
    setQueue((q) => [...q, entry]);

    // If it has a barcode and isn't already a custom_product, remember it
    if (entry.barcode && warehouseId) {
      try {
        const userId = await getActiveUserId();
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
    setShelfLifeDaysHint(null);
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
      const userId = await getActiveUserId();
      if (!userId) throw new Error('Not signed in.');
      // Sequential add-or-merge: same product + same expiry (incl. matching a
      // row already in the box, or an earlier draft this session) bumps the
      // quantity; a different expiry stays a separate batch for FIFO rotation.
      for (const d of queue) {
        await addOrMergeItem(boxId, userId, {
          name: d.name,
          quantity: d.quantity,
          unit: d.unit,
          expiry_date: d.expiry_date,
          barcode: d.barcode,
          image_url: d.image_url,
          category: d.category,
          pack_count: d.pack_count,
          energy_kcal_per_100g: d.energy_kcal_per_100g,
          net_weight_g: d.net_weight_g,
          // Smart-write par level: barcoded products store it as an aggregate
          // on custom_products (below), so keep the per-row column null.
          min_quantity: d.barcode ? null : d.min_quantity,
        });
      }

      // Route barcoded par levels to the shared custom_products row.
      if (warehouseId) {
        for (const d of queue) {
          if (d.barcode && d.min_quantity != null) {
            await setCustomProductMinQuantity({
              warehouse_id: warehouseId,
              barcode: d.barcode,
              min: d.min_quantity,
              name: d.name,
              category: d.category,
              created_by: userId,
            }).catch(() => {});
          }
        }
      }
      // Restock loop: the purchased item is now in inventory, so clear it
      // from the shopping list.
      if (shoppingItemIdRef.current) {
        await deleteShoppingItem(shoppingItemIdRef.current).catch(() => {});
        shoppingItemIdRef.current = null;
      }
      router.replace(`/warehouse/${warehouseId}/box/${boxId}` as any);
    } catch (e: any) {
      appToast.error(e?.message ?? 'Cannot save.');
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

  // Only gate on camera permission while we're actually in the scanner.
  // Once the user picks "Add manually" and we switch to form/queue mode,
  // the camera is irrelevant — let the normal render path handle those.
  if (!permission.granted && mode === 'scan') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Icon brand="camera" size={96} style={styles.permIcon} />
          <Text style={styles.permTitle}>Camera access needed</Text>
          <Text style={styles.permText}>
            I need camera access to scan product barcodes.
          </Text>
          <Pressable style={[styles.btn, styles.btnPrimary, styles.permBtn]} onPress={requestPermission}>
            <Text style={styles.btnPrimaryText}>Allow camera</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnSecondary, styles.permBtn]} onPress={handleManual}>
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

        {/* Shopping-list restock context: signals why the screen was opened,
            and that the linked shopping row will clear once an item is saved. */}
        {shoppingItemIdRef.current && prefillName && (
          <View style={styles.restockBanner}>
            <Icon sf="bag.fill" size={14} color={colors.success} />
            <Text style={styles.restockBannerText} numberOfLines={1}>
              Restocking: {prefillName}
            </Text>
            <Text style={styles.restockBannerHint}>row clears on first save</Text>
          </View>
        )}

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
            <Pressable
              onPress={showImagePicker}
              disabled={uploadingImage}
              style={({ pressed }) => [styles.draftImageTile, pressed && { opacity: 0.7 }]}
            >
              {draft.image_url ? (
                <Image source={{ uri: getCachedUri(draft.image_url)! }} style={styles.draftImage} />
              ) : (
                <View style={styles.draftImagePlaceholder}>
                  <Icon
                    sf={draft.category ? CATEGORY_SF[draft.category] : 'camera.fill'}
                    size={48}
                    color={colors.textMuted}
                  />
                  <Text style={styles.draftImageHint}>Tap to add photo</Text>
                </View>
              )}
              {uploadingImage && (
                <View style={styles.draftImageOverlay}>
                  <ActivityIndicator color="#FFFFFF" />
                </View>
              )}
            </Pressable>

            <SourceBanner source={draftSource} barcode={draft.barcode ?? null} />

            {visionEnabled && !uploadingImage && (
              <Pressable
                style={({ pressed }) => [
                  styles.identifyBtn,
                  identifying && { opacity: 0.6 },
                  pressed && !identifying && { opacity: 0.7 },
                ]}
                onPress={draft.image_url ? handleIdentifyAI : identifyWithNewPhoto}
                disabled={identifying}
              >
                {identifying ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <>
                    <Icon sf="sparkles" size={16} color={colors.primary} />
                    <Text style={styles.identifyBtnText}>
                      {draft.image_url ? 'Identify with AI' : 'Identify with AI (photo)'}
                    </Text>
                  </>
                )}
              </Pressable>
            )}

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
                  onChangeText={(v) => {
                    const digits = v.replace(/[^0-9]/g, '');
                    setDraft({ ...draft, quantity: digits ? parseInt(digits, 10) : 0 });
                  }}
                  keyboardType="number-pad"
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

            {draft.unit === 'pack' && (
              <>
                <Text style={styles.label}>Pcs inside one package (optional)</Text>
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
                    setDraft({ ...draft, expiry_date: '' });
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
            )}
            {!isNeverExpires(draft.expiry_date) && shelfLifeDaysHint != null && !draft.expiry_date && (
              <Text style={styles.shelfLifeHint}>
                Typical shelf life: ~{formatShelfLife(shelfLifeDaysHint)} — check the label.
              </Text>
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
            <CategoryPickerTrigger
              value={draft.category ?? null}
              onPress={() => setShowCategoryPicker(true)}
            />

            <Pressable
              style={({ pressed }) => [styles.disclosureToggle, pressed && { opacity: 0.6 }]}
              onPress={() => setShowMoreDetails((v) => !v)}
            >
              <Icon
                sf={showMoreDetails ? 'chevron.down' : 'chevron.right'}
                size={14}
                color={colors.textMuted}
              />
              <Text style={styles.disclosureToggleText}>
                {showMoreDetails ? 'Hide details' : 'More details (optional)'}
              </Text>
            </Pressable>

            {showMoreDetails && (
              <>
                {(draft.category === 'food' || draft.category === 'water') && (
                  <View style={styles.row}>
                    {draft.category === 'food' && (
                      <View style={{ flex: 1 }}>
                        <Text style={styles.label}>kcal / 100 g</Text>
                        <TextInput
                          value={draft.energy_kcal_per_100g != null ? String(draft.energy_kcal_per_100g) : ''}
                          onChangeText={(v) =>
                            setDraft({ ...draft, energy_kcal_per_100g: parsePositiveNumber(v) })
                          }
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
                        value={draft.net_weight_g != null ? String(draft.net_weight_g) : ''}
                        onChangeText={(v) =>
                          setDraft({ ...draft, net_weight_g: parsePositiveNumber(v) })
                        }
                        placeholder={draft.category === 'water' ? 'e.g. 1500' : 'e.g. 500'}
                        placeholderTextColor={colors.textSubtle}
                        keyboardType="decimal-pad"
                        style={styles.input}
                      />
                    </View>
                  </View>
                )}

                <Text style={styles.label}>Low-stock alert below (optional)</Text>
                <TextInput
                  value={draft.min_quantity != null ? String(draft.min_quantity) : ''}
                  onChangeText={(v) => setDraft({ ...draft, min_quantity: parsePositiveNumber(v) })}
                  placeholder="e.g. 2"
                  placeholderTextColor={colors.textSubtle}
                  keyboardType="decimal-pad"
                  style={styles.input}
                />
              </>
            )}

            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={handleAddToQueue}>
              <View style={styles.btnContent}>
                <Icon sf="plus" size={18} color={colors.textOnPrimary} />
                <Text style={styles.btnPrimaryText}>Add to queue</Text>
              </View>
            </Pressable>

            <Pressable
              style={[styles.btn, styles.btnSecondary]}
              onPress={() => {
                // Clean up orphan upload if user picked a photo but cancels
                if (draft?.image_url) {
                  deleteProductImage(draft.image_url).catch(() => {});
                }
                setDraft(null);
                setDraftSource(null);
                setShowDatePicker(false);
                setShelfLifeDaysHint(null);
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
            style={{ flex: 1 }}
            contentContainerStyle={styles.queueList}
            renderItem={({ item }) => (
              <QueueRow
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

      <CategoryPickerSheet
        visible={showCategoryPicker}
        value={draft?.category ?? null}
        onSelect={(c) => setDraft((d) => (d ? { ...d, category: c } : d))}
        onClose={() => setShowCategoryPicker(false)}
      />
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

// QueueRow — a list row (like box items): swipe left → Delete, swipe right →
// "New date" (clone for another expiry of the same product).
function QueueRow({
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
  const swipeRef = useRef<Swipeable>(null);

  return (
    <Swipeable
      ref={swipeRef}
      renderRightActions={() => (
        <Pressable style={styles.queueDeleteAction} onPress={onRemove}>
          <Icon sf="trash.fill" size={18} color="#FFFFFF" />
          <Text style={styles.queueActionText}>Delete</Text>
        </Pressable>
      )}
      renderLeftActions={() => (
        <Pressable
          style={styles.queueDateAction}
          onPress={() => {
            swipeRef.current?.close();
            onSameAgain();
          }}
        >
          <Icon sf="calendar.badge.plus" size={18} color={colors.warningText} />
          <Text style={[styles.queueActionText, { color: colors.warningText }]}>New date</Text>
        </Pressable>
      )}
      rightThreshold={40}
      leftThreshold={40}
      overshootRight={false}
      overshootLeft={false}
    >
      <View style={styles.queueRow}>
        {draft.image_url ? (
          <Image source={{ uri: getCachedUri(draft.image_url)! }} style={styles.queueRowThumb} />
        ) : (
          <View style={styles.queueRowIcon}>
            <Icon
              sf={draft.category ? CATEGORY_SF[draft.category] : 'shippingbox.fill'}
              size={20}
              color={colors.textMuted}
            />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.queueRowName} numberOfLines={1}>
            {draft.name || 'Unnamed'}
          </Text>
          <Text style={styles.queueRowQty} numberOfLines={1}>
            {formatItemQuantity(draft)}
          </Text>
        </View>
        <View style={[styles.queueBadge, { marginTop: 0, backgroundColor: palette.bg }]}>
          <Text style={[styles.queueBadgeText, { color: palette.fg }]} numberOfLines={1}>
            {formatExpiry(draft.expiry_date)}
          </Text>
        </View>
      </View>
    </Swipeable>
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
  // Stretch the permission CTA buttons to a sane width inside the
  // centered column. The shared `btn` style is otherwise full-width
  // when used in a flex parent, but `center` with alignItems:'center'
  // shrinks children to content width — these need an explicit min.
  permBtn: { alignSelf: 'stretch', minWidth: 240 },
  // Scanner
  // A short camera band — only the barcode frame matters, so it doesn't need
  // to fill the screen; the queue list takes the rest.
  cameraWrap: { height: 220, backgroundColor: '#000', overflow: 'hidden' },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanFrame: {
    width: 260,
    height: 110,
    borderRadius: radius.md,
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  scanText: {
    ...typography.subhead,
    color: '#FFFFFF',
    fontWeight: '600',
    marginTop: spacing.md,
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
  draftImageTile: {
    alignSelf: 'center',
    width: 140,
    height: 140,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  draftImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  draftImagePlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  draftImageHint: {
    ...typography.footnote,
    color: colors.textMuted,
    fontWeight: '600',
  },
  draftImageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  identifyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primaryTint,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primarySubtle,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  identifyBtnText: {
    ...typography.subhead,
    color: colors.primary,
    fontWeight: '700',
  },
  shelfLifeHint: {
    ...typography.footnote,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginTop: spacing.xs,
    marginLeft: spacing.xs,
  },
  restockBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.successBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.successBgStrong,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs + 2,
  },
  restockBannerText: { ...typography.footnote, color: colors.successText, fontWeight: '700', flex: 1 },
  restockBannerHint: { ...typography.caption, color: colors.successText, opacity: 0.7 },
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
  disclosureToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
  },
  disclosureToggleText: {
    ...typography.footnote,
    color: colors.textMuted,
    fontWeight: '600',
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
    flex: 1,
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
  queueBadge: {
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  queueBadgeText: { fontSize: 9, fontWeight: '700' },
  // List-view queue rows (like box items) + swipe actions
  queueRow: {
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
  queueRowThumb: { width: 36, height: 36, borderRadius: radius.sm + 2, resizeMode: 'contain' },
  queueRowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm + 2,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueRowName: { ...typography.body, color: colors.text, fontWeight: '600' },
  queueRowQty: { ...typography.footnote, color: colors.textMuted, marginTop: 1 },
  queueDeleteAction: {
    backgroundColor: colors.danger,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
    width: 84,
    borderTopRightRadius: radius.md,
    borderBottomRightRadius: radius.md,
  },
  queueDateAction: {
    backgroundColor: colors.warningBg,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
    width: 84,
    borderTopLeftRadius: radius.md,
    borderBottomLeftRadius: radius.md,
  },
  queueActionText: { ...typography.caption, color: '#FFFFFF', fontWeight: '700' },
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
