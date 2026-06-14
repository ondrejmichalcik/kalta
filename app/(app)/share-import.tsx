// ============================================================================
// Kalta – Import a shared purchase (Sprint 9, Share Extension)
// Entry point for content shared into Kalta from another app (Mail, Safari, a
// store app) via the iOS Share Extension: a receipt PDF, an order screenshot,
// pasted text, or a web URL. The user picks a destination box, then the same
// AI extraction as the in-box "Import a purchase" flow runs the content
// through extractPurchase → AiProposalSheet → batch-add. BYOK + cloud gated.
// ============================================================================
import { useEffect, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { readAsStringAsync } from 'expo-file-system/legacy';
import {
  addItemsBatch,
  getActiveUserId,
  getMyWarehouses,
  listBoxes,
  type NewItemInput,
} from '@/src/lib/supabase';
import { uploadProductImage } from '@/src/lib/storage';
import { extractPurchase, type PurchaseInput } from '@/src/lib/importPurchase';
import { AiProposalSheet } from '@/src/components/AiProposalSheet';
import type { AiProposal } from '@/src/lib/aiProposal';
import type { Box, WarehouseWithRole } from '@/src/types/database';
import { colors, radius, shadows, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';
import { toast, showAlert } from '@/src/lib/feedback';

/** Prefix a bare filesystem path with file:// so RN/Expo file APIs accept it. */
function toFileUri(path: string): string {
  if (/^[a-z]+:\/\//i.test(path)) return path;
  return `file://${path}`;
}

export default function ShareImportScreen() {
  const router = useRouter();
  const { shareIntent, hasShareIntent, resetShareIntent } = useShareIntentContext();

  const [uid, setUid] = useState<string | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseWithRole[]>([]);
  const [warehouse, setWarehouse] = useState<WarehouseWithRole | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [boxId, setBoxId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<AiProposal | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const file = shareIntent?.files?.[0] ?? null;
  const sharedText = shareIntent?.text ?? shareIntent?.webUrl ?? null;
  const isImage = !!file && file.mimeType.startsWith('image/');
  const isPdf = !!file && file.mimeType === 'application/pdf';

  // Leaving the screen (back / done) clears the intent so it can't re-fire.
  const dismiss = () => {
    resetShareIntent();
    router.replace('/' as any);
  };

  // --- Load destinations ---
  useEffect(() => {
    (async () => {
      try {
        const id = await getActiveUserId();
        setUid(id);
        if (!id) return;
        const whs = await getMyWarehouses(id);
        setWarehouses(whs);
        if (whs.length === 1) await selectWarehouse(whs[0]);
      } catch {
        // non-fatal — user can still back out
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectWarehouse = async (wh: WarehouseWithRole) => {
    setWarehouse(wh);
    setBoxId(null);
    try {
      const list = await listBoxes(wh.id);
      setBoxes(list);
      if (list.length === 1) setBoxId(list[0].id);
    } catch {
      setBoxes([]);
    }
  };

  const pickWarehouse = () => {
    if (warehouses.length < 2) return;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'Import into warehouse',
        options: [...warehouses.map((w) => w.name), 'Cancel'],
        cancelButtonIndex: warehouses.length,
      },
      (i) => {
        if (i < warehouses.length) selectWarehouse(warehouses[i]);
      },
    );
  };

  // --- Map the shared content into an extractPurchase input ---
  const buildInput = async (): Promise<PurchaseInput | null> => {
    if (isImage && file) {
      if (!warehouse) return null;
      const url = await uploadProductImage(warehouse.id, toFileUri(file.path));
      if (url.startsWith('local:')) {
        toast.error('Image import needs cloud sync enabled.');
        return null;
      }
      return { type: 'image', url };
    }
    if (isPdf && file) {
      const base64 = await readAsStringAsync(toFileUri(file.path), { encoding: 'base64' });
      return { type: 'pdf', base64 };
    }
    const t = sharedText?.trim();
    if (t) return { type: 'text', text: t };
    toast.error("That shared content can't be imported.");
    return null;
  };

  const runExtract = async () => {
    setBusy(true);
    try {
      const input = await buildInput();
      if (!input) return;
      const result = await extractPurchase(input);
      if (result.kind !== 'items' || result.drafts.length === 0) {
        toast.info('No items were detected in that purchase.');
        return;
      }
      setProposal(result);
      setSheetOpen(true);
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not read the shared purchase.');
    } finally {
      setBusy(false);
    }
  };

  // BYOK cost → explicit opt-in before the network call.
  const confirmExtract = () => {
    if (!boxId) {
      toast.info('Choose which box to import the items into.');
      return;
    }
    showAlert(
      'Import purchase',
      'Send the shared content to Anthropic to extract items? This uses your API key.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Import', onPress: runExtract },
      ],
    );
  };

  const applyDrafts = async (edited: AiProposal) => {
    if (edited.kind !== 'items' || !boxId || !uid) return;
    const now = Date.now();
    const items: NewItemInput[] = edited.drafts.map((d) => ({
      name: d.name,
      quantity: d.quantity,
      unit: 'pcs',
      category: d.category,
      expiry_date:
        d.estExpiryDays != null
          ? new Date(now + d.estExpiryDays * 86400000).toISOString().slice(0, 10)
          : null,
    }));
    try {
      await addItemsBatch(boxId, uid, items);
      toast.success(
        `${items.length} ${items.length === 1 ? 'item' : 'items'} added to the box.`,
      );
      dismiss();
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not add items.');
    }
  };

  // Pushed only when something was shared, but guard against an empty intent
  // (e.g. after reset) so the screen never gets stuck blank.
  if (!loading && !hasShareIntent && !sheetOpen) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.empty}>
          <Icon sf="tray" size={48} color={colors.textSubtle} />
          <Text style={styles.emptyText}>Nothing was shared.</Text>
          <Pressable style={styles.linkBtn} onPress={dismiss}>
            <Text style={styles.linkBtnText}>Back to Kalta</Text>
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
          onPress={dismiss}
          style={({ pressed }) => [styles.topBarBtn, pressed && { opacity: 0.5 }]}
        >
          <Icon sf="xmark" size={20} color={colors.text} />
        </Pressable>
        <Text style={styles.topBarTitle}>Import shared purchase</Text>
        <View style={styles.topBarBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* What was shared */}
        <Text style={styles.label}>SHARED CONTENT</Text>
        <View style={styles.card}>
          {isImage && file ? (
            <View style={styles.sharedRow}>
              <Image source={{ uri: toFileUri(file.path) }} style={styles.thumb} />
              <View style={styles.sharedMeta}>
                <Text style={styles.sharedKind}>Screenshot / photo</Text>
                <Text style={styles.sharedName} numberOfLines={1}>
                  {file.fileName}
                </Text>
              </View>
            </View>
          ) : isPdf && file ? (
            <View style={styles.sharedRow}>
              <View style={styles.fileIcon}>
                <Icon sf="doc.fill" size={24} color={colors.primary} />
              </View>
              <View style={styles.sharedMeta}>
                <Text style={styles.sharedKind}>PDF invoice</Text>
                <Text style={styles.sharedName} numberOfLines={1}>
                  {file.fileName}
                </Text>
              </View>
            </View>
          ) : sharedText ? (
            <Text style={styles.sharedTextBody} numberOfLines={6}>
              {sharedText}
            </Text>
          ) : (
            <Text style={styles.sharedKind}>Unsupported content</Text>
          )}
        </View>

        {/* Destination */}
        <Text style={[styles.label, { marginTop: spacing.lg }]}>DESTINATION</Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />
        ) : warehouses.length === 0 ? (
          <Text style={styles.hint}>Create a warehouse first to import items.</Text>
        ) : (
          <>
            <Pressable
              style={({ pressed }) => [styles.whRow, pressed && { opacity: 0.7 }]}
              onPress={pickWarehouse}
              disabled={warehouses.length < 2}
            >
              <Icon sf="building.2" size={18} color={colors.textMuted} />
              <Text style={styles.whName}>{warehouse?.name ?? 'Select warehouse'}</Text>
              {warehouses.length > 1 && (
                <Icon sf="chevron.up.chevron.down" size={14} color={colors.textSubtle} />
              )}
            </Pressable>

            {warehouse && (
              <View style={styles.boxList}>
                {boxes.length === 0 ? (
                  <Text style={styles.hint}>This warehouse has no boxes yet.</Text>
                ) : (
                  boxes.map((b) => {
                    const selected = b.id === boxId;
                    return (
                      <Pressable
                        key={b.id}
                        style={({ pressed }) => [
                          styles.boxRow,
                          selected && styles.boxRowSelected,
                          pressed && { opacity: 0.7 },
                        ]}
                        onPress={() => setBoxId(b.id)}
                      >
                        <Icon
                          sf={selected ? 'checkmark.circle.fill' : 'circle'}
                          size={20}
                          color={selected ? colors.primary : colors.textSubtle}
                        />
                        <Text style={styles.boxName}>{b.name}</Text>
                        <Text style={styles.boxCount}>{b.item_count}</Text>
                      </Pressable>
                    );
                  })
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [
            styles.primaryBtn,
            (!boxId || busy) && { opacity: 0.4 },
            pressed && { opacity: 0.8 },
          ]}
          onPress={confirmExtract}
          disabled={!boxId || busy}
        >
          {busy ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <>
              <Icon sf="sparkles" size={16} color={colors.textOnPrimary} />
              <Text style={styles.primaryBtnText}>Extract &amp; review</Text>
            </>
          )}
        </Pressable>
      </View>

      <AiProposalSheet
        visible={sheetOpen}
        proposal={proposal}
        title="Import purchase"
        confirmLabel={undefined}
        onConfirm={applyDrafts}
        onClose={() => setSheetOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  topBarBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  topBarTitle: {
    ...typography.headline,
    color: colors.text,
    flex: 1,
    textAlign: 'center',
    marginHorizontal: spacing.sm,
  },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  label: { ...typography.label, color: colors.textMuted, marginBottom: spacing.xs },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  sharedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  thumb: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: colors.background },
  fileIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sharedMeta: { flex: 1 },
  sharedKind: { ...typography.footnote, color: colors.textMuted },
  sharedName: { ...typography.body, color: colors.text, fontWeight: '600' },
  sharedTextBody: { ...typography.body, color: colors.text, lineHeight: 20 },
  hint: { ...typography.footnote, color: colors.textMuted, marginTop: spacing.sm },
  whRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  whName: { ...typography.body, color: colors.text, fontWeight: '600', flex: 1 },
  boxList: { marginTop: spacing.sm, gap: spacing.xs },
  boxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  boxRowSelected: { borderColor: colors.primary, backgroundColor: colors.primarySubtle },
  boxName: { ...typography.body, color: colors.text, flex: 1 },
  boxCount: { ...typography.footnote, color: colors.textSubtle },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.md,
    ...shadows.sm,
  },
  primaryBtnText: { ...typography.bodyStrong, color: colors.textOnPrimary },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  emptyText: { ...typography.body, color: colors.textMuted },
  linkBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  linkBtnText: { ...typography.body, color: colors.primary, fontWeight: '600' },
});
