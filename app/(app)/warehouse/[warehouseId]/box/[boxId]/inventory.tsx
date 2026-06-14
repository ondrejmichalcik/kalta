// ============================================================================
// Kalta – Box Inventory session
// Flow: empty the box physically → scan each item one by one (app auto-
// counts) or scan once + enter qty → mark opened items → complete →
// report of found vs DB state → confirm → save.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
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
import * as Haptics from 'expo-haptics';
import {
  completeInventorySession,
  createInventorySession,
  deleteItem,
  getActiveUserId,
  getBoxById,
  listItems,
  supabase,
  updateItem,
} from '@/src/lib/supabase';
import type { Box, Item } from '@/src/types/database';
import { formatItemQuantity } from '@/src/types/database';
import { colors, radius, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';
import { toast, showAlert, showPrompt } from '@/src/lib/feedback';

type Phase = 'scanning' | 'report';

interface FoundEntry {
  itemId: string;
  name: string;
  unit: string;
  dbQuantity: number;
  foundQty: number;
  opened: boolean;
  damaged: boolean;
  notes: string | null;
  barcode: string | null;
}

export default function InventoryScreen() {
  const router = useRouter();
  const { warehouseId, boxId } = useLocalSearchParams<{
    warehouseId: string;
    boxId: string;
  }>();
  const [box, setBox] = useState<Box | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>('scanning');
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Found items map: keyed by item.id
  const [foundMap, setFoundMap] = useState<Record<string, FoundEntry>>({});
  const [torch, setTorch] = useState(false);
  const [showManualPicker, setShowManualPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const lastBarcodeRef = useRef<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const foundEntries = useMemo(() => Object.values(foundMap), [foundMap]);
  const foundItemIds = useMemo(() => new Set(Object.keys(foundMap)), [foundMap]);
  const unscannedItems = useMemo(
    () => items.filter((i) => !foundItemIds.has(i.id)),
    [items, foundItemIds],
  );

  // Load box + items + create session
  useEffect(() => {
    (async () => {
      if (!boxId) return;
      try {
        const [b, is] = await Promise.all([getBoxById(boxId), listItems(boxId)]);
        setBox(b);
        setItems(is);
        const userId = await getActiveUserId();
        if (userId) {
          const session = await createInventorySession(boxId, userId);
          setSessionId(session.id);
        }
      } catch (e: any) {
        toast.error(e?.message ?? 'Cannot load box.');
        router.back();
      } finally {
        setLoading(false);
      }
    })();
  }, [boxId]);

  // ---- Barcode scan → auto-increment ----
  const handleScan = useCallback(
    (barcode: string) => {
      if (lastBarcodeRef.current === barcode) return;
      lastBarcodeRef.current = barcode;

      // Find matching item in this box
      const match = items.find((i) => i.barcode === barcode);

      if (match) {
        setFoundMap((prev) => {
          const existing = prev[match.id];
          if (existing) {
            // Already scanned → increment +1
            return { ...prev, [match.id]: { ...existing, foundQty: existing.foundQty + 1 } };
          }
          // First scan of this item
          return {
            ...prev,
            [match.id]: {
              itemId: match.id,
              name: match.name,
              unit: match.unit,
              dbQuantity: match.quantity,
              foundQty: 1,
              opened: match.opened,
              damaged: match.damaged,
              notes: match.notes,
              barcode,
            },
          };
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        toast.error('No item with this barcode in this box.');
      }

      setTimeout(() => { lastBarcodeRef.current = null; }, 1500);
    },
    [items],
  );

  // ---- Manual pick ----
  const handleManualPick = (item: Item) => {
    setShowManualPicker(false);
    setFoundMap((prev) => {
      const existing = prev[item.id];
      if (existing) {
        return { ...prev, [item.id]: { ...existing, foundQty: existing.foundQty + 1 } };
      }
      return {
        ...prev,
        [item.id]: {
          itemId: item.id,
          name: item.name,
          unit: item.unit,
          dbQuantity: item.quantity,
          foundQty: 1,
          opened: item.opened,
          damaged: item.damaged,
          notes: item.notes,
          barcode: item.barcode,
        },
      };
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  // ---- Adjust found qty ----
  // No upper cap — inventory can discover MORE items than DB expects.
  // Qty=0 means "scanned/checked but found none" — item stays in
  // foundMap (distinguished from "not scanned at all"). Reconciliation
  // will DELETE the item from DB when foundQty=0.
  const adjustQty = (itemId: string, delta: number) => {
    setFoundMap((prev) => {
      const e = prev[itemId];
      if (!e) return prev;
      const newQty = Math.max(0, e.foundQty + delta);
      return { ...prev, [itemId]: { ...e, foundQty: newQty } };
    });
  };

  const setQtyDirect = (itemId: string, qty: number) => {
    setFoundMap((prev) => {
      const e = prev[itemId];
      if (!e) return prev;
      return { ...prev, [itemId]: { ...e, foundQty: Math.max(0, qty) } };
    });
  };

  // ---- Toggle conditions ----
  const toggleOpened = (itemId: string) => {
    setFoundMap((prev) => {
      const e = prev[itemId];
      if (!e) return prev;
      return { ...prev, [itemId]: { ...e, opened: !e.opened } };
    });
  };

  const toggleDamaged = (itemId: string) => {
    setFoundMap((prev) => {
      const e = prev[itemId];
      if (!e) return prev;
      return { ...prev, [itemId]: { ...e, damaged: !e.damaged } };
    });
  };

  const editNotes = (itemId: string) => {
    const current = foundMap[itemId]?.notes ?? '';
    showPrompt(
      'Item note',
      'Add a note about this item\'s condition.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: (text?: string) => {
            setFoundMap((prev) => {
              const e = prev[itemId];
              if (!e) return prev;
              return { ...prev, [itemId]: { ...e, notes: text?.trim() || null } };
            });
          },
        },
      ],
      { defaultValue: current },
    );
  };

  // ---- Remove from scanned ----
  const removeEntry = (itemId: string) => {
    setFoundMap((prev) => {
      const { [itemId]: _, ...rest } = prev;
      return rest;
    });
  };

  // ---- Complete ----
  const goToReport = () => setPhase('report');

  const confirmReport = () => {
    const missingCount = unscannedItems.length;
    if (missingCount > 0) {
      showAlert(
        `${missingCount} item${missingCount > 1 ? 's' : ''} not found`,
        'Items you didn\'t scan will be removed from the box. If you just forgot to scan something, go back and scan it first.',
        [
          { text: 'Go back', style: 'cancel', onPress: () => setPhase('scanning') },
          {
            text: 'Keep in box',
            onPress: () => doSave(false),
          },
          {
            text: 'Remove missing',
            style: 'destructive',
            onPress: () => doSave(true),
          },
        ],
      );
    } else {
      doSave(false);
    }
  };

  // ---- Confirm & save ----
  const doSave = async (deleteMissing: boolean) => {
    if (!sessionId) return;
    try {
      setSaving(true);

      const lines = [
        // Found / partial lines — foundQty can be MORE than dbQuantity
        // (inventory discovered extra items). Status is still 'found'
        // when qty >= expected, 'partial' when less.
        ...foundEntries.map((e) => ({
          item_id: e.itemId,
          item_name: e.name,
          item_quantity: e.dbQuantity,
          item_unit: e.unit,
          found_quantity: e.foundQty,
          status: (e.foundQty >= e.dbQuantity ? 'found' : 'partial') as 'found' | 'partial' | 'missing',
          scanned_barcode: e.barcode,
        })),
        // Missing lines (not scanned at all)
        ...unscannedItems.map((i) => ({
          item_id: i.id,
          item_name: i.name,
          item_quantity: i.quantity,
          item_unit: i.unit,
          found_quantity: 0,
          status: 'missing' as const,
          scanned_barcode: null,
        })),
      ];

      const verifiedIds = foundEntries.filter((e) => e.foundQty > 0).map((e) => e.itemId);

      await completeInventorySession(sessionId, lines, verifiedIds);

      // Reconcile DB with inventory findings:
      // - foundQty > 0: update quantity + opened status to match reality
      // - foundQty = 0: DELETE item from DB (confirmed gone during inventory)
      // - Items not scanned at all: left as-is (user might have forgotten)
      // Items scanned with qty=0 → confirmed gone, delete
      const toDeleteFromFound = foundEntries.filter((e) => e.foundQty === 0);
      // Items not scanned at all → optionally delete if user chose to
      const toDeleteMissing = deleteMissing
        ? items.filter((i) => !foundItemIds.has(i.id))
        : [];
      const toUpdate = foundEntries.filter((e) => e.foundQty > 0);

      for (const e of toDeleteFromFound) {
        try {
          await deleteItem(e.itemId);
        } catch (delErr: any) {
          toast.error(`"${e.name}": ${delErr?.message}`);
        }
      }

      for (const i of toDeleteMissing) {
        try {
          await deleteItem(i.id);
        } catch (delErr: any) {
          toast.error(`"${i.name}": ${delErr?.message}`);
        }
      }

      for (const e of toUpdate) {
        const dbItem = items.find((i) => i.id === e.itemId);
        if (!dbItem) continue;
        const patch: Record<string, any> = {};
        if (e.foundQty !== dbItem.quantity) patch.quantity = e.foundQty;
        if (e.opened !== dbItem.opened) patch.opened = e.opened;
        if (e.damaged !== dbItem.damaged) patch.damaged = e.damaged;
        if ((e.notes ?? null) !== (dbItem.notes ?? null)) patch.notes = e.notes;
        if (Object.keys(patch).length > 0) {
          await updateItem(e.itemId, patch);
        }
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

      const fc = lines.filter((l) => l.status === 'found').length;
      const pc = lines.filter((l) => l.status === 'partial').length;
      const mc = lines.filter((l) => l.status === 'missing').length;
      const parts = [];
      if (fc) parts.push(`${fc} found`);
      if (pc) parts.push(`${pc} partial`);
      if (mc) parts.push(`${mc} missing`);
      const totalDeleted = toDeleteFromFound.length + toDeleteMissing.length;
      if (totalDeleted) parts.push(`${totalDeleted} deleted`);
      if (toUpdate.length) parts.push(`${toUpdate.length} updated`);

      toast.success(parts.join(', '));
      router.back();
    } catch (e: any) {
      toast.error(e?.message ?? 'Cannot save.');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) requestPermission();
  }, [permission]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // ======== REPORT PHASE ========
  if (phase === 'report') {
    const missingItems = unscannedItems;
    const partialEntries = foundEntries.filter((e) => e.foundQty < e.dbQuantity);
    const fullEntries = foundEntries.filter((e) => e.foundQty >= e.dbQuantity);

    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <Pressable hitSlop={12} onPress={() => setPhase('scanning')} style={({ pressed }) => [styles.topBarBtn, pressed && { opacity: 0.5 }]}>
            <Icon sf="chevron.left" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.topBarTitle}>Inventory report</Text>
          <View style={styles.topBarBtn} />
        </View>

        <ScrollView contentContainerStyle={styles.reportScroll}>
          {/* Summary */}
          <View style={styles.reportSummary}>
            <View style={styles.reportSummaryItem}>
              <Text style={styles.reportSummaryNumber}>{fullEntries.length}</Text>
              <Text style={styles.reportSummaryLabel}>Full</Text>
            </View>
            <View style={styles.reportSummaryDivider} />
            <View style={styles.reportSummaryItem}>
              <Text style={[styles.reportSummaryNumber, partialEntries.length > 0 && { color: colors.warningText }]}>{partialEntries.length}</Text>
              <Text style={styles.reportSummaryLabel}>Partial</Text>
            </View>
            <View style={styles.reportSummaryDivider} />
            <View style={styles.reportSummaryItem}>
              <Text style={[styles.reportSummaryNumber, missingItems.length > 0 && { color: colors.danger }]}>{missingItems.length}</Text>
              <Text style={styles.reportSummaryLabel}>Missing</Text>
            </View>
          </View>

          {/* Found items */}
          {foundEntries.length > 0 && (
            <>
              <Text style={styles.reportSection}>SCANNED</Text>
              {foundEntries.map((e) => {
                const isPartial = e.foundQty < e.dbQuantity;
                const isExtra = e.foundQty > e.dbQuantity;
                return (
                  <View key={e.itemId} style={[styles.reportRow, isPartial && styles.reportRowPartial, isExtra && styles.reportRowExtra]}>
                    <Icon
                      sf={isPartial ? 'exclamationmark.circle.fill' : isExtra ? 'plus.circle.fill' : 'checkmark.circle.fill'}
                      size={20}
                      color={isPartial ? colors.warningText : isExtra ? colors.infoText : colors.success}
                    />
                    <View style={styles.reportRowBody}>
                      <Text style={styles.reportRowName} numberOfLines={1}>{e.name}</Text>
                      <View style={styles.reportRowDetail}>
                        <Text style={styles.reportRowExpected}>
                          Found {e.foundQty} of {e.dbQuantity} {e.unit}
                          {isExtra ? ` (+${e.foundQty - e.dbQuantity} extra)` : ''}
                        </Text>
                        <View style={styles.reportBadges}>
                          {e.opened && <Text style={styles.reportBadgeOpened}>OPENED</Text>}
                          {e.damaged && <Text style={styles.reportBadgeDamaged}>DAMAGED</Text>}
                          {e.notes && <Text style={styles.reportBadgeNote}>NOTE</Text>}
                        </View>
                      </View>
                    </View>
                  </View>
                );
              })}
            </>
          )}

          {/* Missing */}
          {missingItems.length > 0 && (
            <>
              <Text style={styles.reportSection}>NOT FOUND</Text>
              {missingItems.map((i) => (
                <View key={i.id} style={[styles.reportRow, styles.reportRowMissing]}>
                  <Icon sf="xmark.circle.fill" size={20} color={colors.danger} />
                  <View style={styles.reportRowBody}>
                    <Text style={styles.reportRowName} numberOfLines={1}>{i.name}</Text>
                    <Text style={styles.reportRowExpected}>{i.quantity} {i.unit} expected</Text>
                  </View>
                </View>
              ))}
            </>
          )}
        </ScrollView>

        <View style={styles.reportFooter}>
          <Pressable
            style={({ pressed }) => [styles.reportConfirmBtn, saving && { opacity: 0.6 }, pressed && !saving && { opacity: 0.8 }]}
            onPress={confirmReport}
            disabled={saving}
          >
            {saving ? <ActivityIndicator color={colors.textOnPrimary} /> : (
              <>
                <Icon sf="checkmark.shield.fill" size={18} color={colors.textOnPrimary} />
                <Text style={styles.reportConfirmText}>Confirm & save</Text>
              </>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ======== SCANNING PHASE ========
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <Pressable
          hitSlop={12}
          onPress={() => {
            showAlert('Cancel inventory?', 'Progress will be lost.', [
              { text: 'Keep scanning', style: 'cancel' },
              { text: 'Cancel', style: 'destructive', onPress: () => router.back() },
            ]);
          }}
          style={({ pressed }) => [styles.topBarBtn, pressed && { opacity: 0.5 }]}
        >
          <Icon sf="xmark" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.topBarTitle}>Inventory: {box?.name}</Text>
        <View style={styles.topBarBtn} />
      </View>

      {/* Progress */}
      <View style={styles.progressBar}>
        <Text style={styles.progressText}>
          {foundEntries.length} of {items.length} items scanned
        </Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${items.length > 0 ? (foundEntries.length / items.length) * 100 : 0}%` }]} />
        </View>
      </View>

      {/* Camera */}
      {permission?.granted ? (
        <View style={styles.cameraWrap}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            enableTorch={torch}
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'] }}
            onBarcodeScanned={({ data }) => handleScan(data)}
          />
          <Pressable style={styles.torchBtn} onPress={() => { Haptics.selectionAsync().catch(() => {}); setTorch((t) => !t); }}>
            <Icon sf={torch ? 'flashlight.on.fill' : 'flashlight.off.fill'} size={24} color="#FFFFFF" />
          </Pressable>
          <View style={styles.scanOverlay} pointerEvents="none">
            <View style={styles.scanFrame} />
            <Text style={styles.scanText}>Scan item barcode — each scan adds +1</Text>
          </View>
        </View>
      ) : (
        <View style={styles.center}>
          <Text style={styles.permText}>Camera access needed for barcode scanning.</Text>
          <Pressable style={styles.permBtn} onPress={requestPermission}>
            <Text style={styles.permBtnText}>Allow camera</Text>
          </Pressable>
        </View>
      )}

      {/* Actions */}
      <View style={styles.actionsRow}>
        <Pressable style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]} onPress={() => setShowManualPicker(true)}>
          <Icon sf="hand.tap.fill" size={18} color={colors.primary} />
          <Text style={styles.actionBtnText}>Manual</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.actionBtnPrimary, pressed && { opacity: 0.8 }]} onPress={goToReport}>
          <Icon sf="checkmark.shield.fill" size={18} color={colors.textOnPrimary} />
          <Text style={styles.actionBtnPrimaryText}>Complete ({foundEntries.length}/{items.length})</Text>
        </Pressable>
      </View>

      {/* Scanned items tally — scrollable list with stepper + opened toggle */}
      {foundEntries.length > 0 && (
        <FlatList
          data={foundEntries}
          keyExtractor={(e) => e.itemId}
          style={styles.tallyList}
          contentContainerStyle={styles.tallyContent}
          renderItem={({ item: e }) => (
            <View style={styles.tallyRow}>
              <View style={styles.tallyRowBody}>
                <Text style={styles.tallyRowName} numberOfLines={1}>{e.name}</Text>
                <View style={styles.tallyConditions}>
                  <Pressable onPress={() => toggleOpened(e.itemId)} style={styles.tallyCondToggle}>
                    <Icon sf={e.opened ? 'checkmark.square.fill' : 'square'} size={14} color={e.opened ? colors.warningText : colors.textMuted} />
                    <Text style={[styles.tallyCondText, e.opened && { color: colors.warningText }]}>Opened</Text>
                  </Pressable>
                  <Pressable onPress={() => toggleDamaged(e.itemId)} style={styles.tallyCondToggle}>
                    <Icon sf={e.damaged ? 'checkmark.square.fill' : 'square'} size={14} color={e.damaged ? colors.danger : colors.textMuted} />
                    <Text style={[styles.tallyCondText, e.damaged && { color: colors.danger }]}>Damaged</Text>
                  </Pressable>
                  <Pressable onPress={() => editNotes(e.itemId)} style={styles.tallyCondToggle}>
                    <Icon sf={e.notes ? 'note.text' : 'square.and.pencil'} size={14} color={e.notes ? colors.infoText : colors.textMuted} />
                    <Text style={[styles.tallyCondText, e.notes && { color: colors.infoText }]}>{e.notes ? 'Note ✓' : 'Note'}</Text>
                  </Pressable>
                </View>
              </View>
              <View style={styles.tallyQtyWrap}>
                <Pressable onPress={() => adjustQty(e.itemId, -1)} style={styles.tallyQtyBtn}>
                  <Icon sf="minus" size={12} color={colors.text} />
                </Pressable>
                <TextInput
                  value={String(e.foundQty)}
                  onChangeText={(v) => {
                    const n = parseInt(v, 10);
                    if (Number.isFinite(n)) setQtyDirect(e.itemId, n);
                  }}
                  keyboardType="number-pad"
                  style={styles.tallyQtyInput}
                  selectTextOnFocus
                />
                <Pressable onPress={() => adjustQty(e.itemId, 1)} style={styles.tallyQtyBtn}>
                  <Icon sf="plus" size={12} color={colors.text} />
                </Pressable>
              </View>
              <Pressable hitSlop={8} onPress={() => removeEntry(e.itemId)}>
                <Icon sf="xmark" size={14} color={colors.textSubtle} />
              </Pressable>
            </View>
          )}
        />
      )}

      {/* Manual picker overlay */}
      {showManualPicker && (
        <View style={styles.manualOverlay}>
          <View style={styles.manualSheet}>
            <View style={styles.manualHeader}>
              <Text style={styles.manualTitle}>Select item</Text>
              <Pressable hitSlop={12} onPress={() => setShowManualPicker(false)}>
                <Text style={styles.manualClose}>Cancel</Text>
              </Pressable>
            </View>
            <FlatList
              data={items}
              keyExtractor={(i) => i.id}
              contentContainerStyle={styles.manualList}
              renderItem={({ item }) => (
                <Pressable style={({ pressed }) => [styles.manualRow, pressed && { opacity: 0.7 }]} onPress={() => handleManualPick(item)}>
                  <Text style={styles.manualRowName} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.manualRowQty}>
                    {foundMap[item.id] ? `${foundMap[item.id].foundQty} found` : formatItemQuantity(item)}
                  </Text>
                  <Icon sf="plus.circle.fill" size={22} color={colors.primary} />
                </Pressable>
              )}
            />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xxl },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  topBarBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  topBarTitle: { ...typography.headline, color: colors.text, flex: 1, textAlign: 'center', marginHorizontal: spacing.sm },

  progressBar: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.xs },
  progressText: { ...typography.footnote, color: colors.text, fontWeight: '700', textAlign: 'center' },
  progressTrack: { height: 6, backgroundColor: colors.palette.neutral[100], borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.success, borderRadius: 3 },

  cameraWrap: { height: 200, backgroundColor: '#000', overflow: 'hidden' },
  torchBtn: { position: 'absolute', top: 12, right: 12, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center' },
  scanOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  scanFrame: { width: 260, height: 100, borderRadius: radius.md, borderWidth: 2, borderColor: '#FFFFFF' },
  scanText: { ...typography.caption, color: '#FFFFFF', fontWeight: '600', marginTop: spacing.sm, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },

  permText: { ...typography.subhead, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.lg },
  permBtn: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.md },
  permBtnText: { ...typography.bodyStrong, color: colors.textOnPrimary },

  actionsRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs + 2, paddingVertical: spacing.sm + 2, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  actionBtnText: { ...typography.footnote, color: colors.primary, fontWeight: '700' },
  actionBtnPrimary: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs + 2, paddingVertical: spacing.sm + 2, borderRadius: radius.md, backgroundColor: colors.primary },
  actionBtnPrimaryText: { ...typography.footnote, color: colors.textOnPrimary, fontWeight: '700' },

  // Scanned tally list
  tallyList: { flex: 1 },
  tallyContent: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, gap: spacing.xs + 2 },
  tallyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm + 2, borderWidth: 1, borderColor: colors.border },
  tallyRowBody: { flex: 1, gap: 4 },
  tallyRowName: { ...typography.body, color: colors.text, fontWeight: '600' },
  tallyConditions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  tallyCondToggle: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  tallyCondText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  tallyQtyWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  tallyQtyBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.palette.neutral[100], alignItems: 'center', justifyContent: 'center' },
  tallyQtyInput: { ...typography.headline, color: colors.text, textAlign: 'center', width: 40, paddingVertical: 2, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },

  // Manual picker
  manualOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  manualSheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '60%' },
  manualHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  manualTitle: { ...typography.headline, color: colors.text },
  manualClose: { ...typography.body, color: colors.primary, fontWeight: '600' },
  manualList: { padding: spacing.lg, gap: spacing.sm },
  manualRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  manualRowName: { ...typography.body, color: colors.text, fontWeight: '600', flex: 1 },
  manualRowQty: { ...typography.footnote, color: colors.textMuted },

  // Report
  reportScroll: { padding: spacing.lg },
  reportSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border },
  reportSummaryItem: { flex: 1, alignItems: 'center', gap: 4 },
  reportSummaryNumber: { ...typography.title1, color: colors.text },
  reportSummaryLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  reportSummaryDivider: { width: 1, height: 40, backgroundColor: colors.border },
  reportSection: { ...typography.caption, color: colors.textMuted, fontWeight: '700', letterSpacing: 1, marginTop: spacing.md, marginBottom: spacing.sm },
  reportRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, marginBottom: spacing.xs },
  reportRowPartial: { backgroundColor: colors.warningBg },
  reportRowExtra: { backgroundColor: colors.infoBg },
  reportRowMissing: { backgroundColor: colors.dangerBg },
  reportRowBody: { flex: 1, gap: 2 },
  reportRowName: { ...typography.body, color: colors.text, fontWeight: '600' },
  reportRowDetail: { gap: 4 },
  reportRowExpected: { ...typography.caption, color: colors.textMuted },
  reportBadges: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  reportBadgeOpened: { fontSize: 8, fontWeight: '800', color: colors.warningText, backgroundColor: colors.warningBg, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3, overflow: 'hidden' },
  reportBadgeDamaged: { fontSize: 8, fontWeight: '800', color: colors.danger, backgroundColor: colors.dangerBg, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3, overflow: 'hidden' },
  reportBadgeNote: { fontSize: 8, fontWeight: '800', color: colors.infoText, backgroundColor: colors.infoBg, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3, overflow: 'hidden' },
  reportFooter: { padding: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  reportConfirmBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.success, paddingVertical: spacing.lg, borderRadius: radius.md },
  reportConfirmText: { ...typography.bodyStrong, color: colors.textOnPrimary },
});
