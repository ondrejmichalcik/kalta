// ============================================================================
// Kalta – Import a purchase (Sprint 8, AI)
// Extract bought items from a receipt photo, an online-order screenshot,
// pasted order text, or a PDF invoice → review via AiProposalSheet → batch-add
// the confirmed drafts into this box. BYOK + subscription gated (extractPurchase).
// ============================================================================
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { readAsStringAsync } from 'expo-file-system/legacy';
import { addItemsBatch, getActiveUserId } from '@/src/lib/supabase';
import { uploadProductImage } from '@/src/lib/storage';
import { extractPurchase } from '@/src/lib/importPurchase';
import { AiProposalSheet } from '@/src/components/AiProposalSheet';
import type { AiProposal } from '@/src/lib/aiProposal';
import type { NewItemInput } from '@/src/lib/supabase';
import { colors, radius, shadows, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';

export default function ImportPurchaseScreen() {
  const router = useRouter();
  const { warehouseId, boxId } = useLocalSearchParams<{ warehouseId: string; boxId: string }>();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [proposal, setProposal] = useState<AiProposal | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const runExtract = async (
    label: string,
    build: () => Promise<Parameters<typeof extractPurchase>[0] | null>,
  ) => {
    setBusy(label);
    try {
      const input = await build();
      if (!input) return;
      const result = await extractPurchase(input);
      if (result.kind !== 'items' || result.drafts.length === 0) {
        Alert.alert('Nothing found', 'No items were detected in that purchase.');
        return;
      }
      setProposal(result);
      setSheetOpen(true);
    } catch (e: any) {
      Alert.alert('Import failed', e?.message ?? 'Could not read the purchase.');
    } finally {
      setBusy(null);
    }
  };

  const fromText = () => {
    const t = text.trim();
    if (!t) {
      Alert.alert('Paste something', 'Paste the order or receipt text first.');
      return;
    }
    confirmThenRun('Send the pasted text to Anthropic to extract items?', 'text', async () => ({
      type: 'text',
      text: t,
    }));
  };

  const fromPhoto = () => {
    confirmThenRun('Upload the image and send it to Anthropic to extract items?', 'photo', async () => {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Allow photo access to import from a screenshot.');
        return null;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
      });
      if (res.canceled || !res.assets[0]) return null;
      if (!warehouseId) return null;
      const url = await uploadProductImage(warehouseId, res.assets[0].uri);
      if (url.startsWith('local:')) {
        Alert.alert('Cloud needed', 'Image import needs cloud sync enabled.');
        return null;
      }
      return { type: 'image', url };
    });
  };

  const fromPdf = () => {
    confirmThenRun('Send the PDF to Anthropic to extract items?', 'pdf', async () => {
      const res = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return null;
      const base64 = await readAsStringAsync(res.assets[0].uri, { encoding: 'base64' });
      return { type: 'pdf', base64 };
    });
  };

  // BYOK cost → explicit opt-in before every network call.
  const confirmThenRun = (
    message: string,
    label: string,
    build: () => Promise<Parameters<typeof extractPurchase>[0] | null>,
  ) => {
    Alert.alert('Import purchase', `${message} This uses your API key.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Import', onPress: () => runExtract(label, build) },
    ]);
  };

  const applyDrafts = async (edited: AiProposal) => {
    if (edited.kind !== 'items' || !boxId) return;
    const uid = await getActiveUserId();
    if (!uid) {
      Alert.alert('Not signed in', 'Cannot add items right now.');
      return;
    }
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
      Alert.alert('Added', `${items.length} ${items.length === 1 ? 'item' : 'items'} added to the box.`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not add items.');
    }
  };

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
        <Text style={styles.topBarTitle}>Import a purchase</Text>
        <View style={styles.topBarBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          Add a whole shop at once. Paste an online order, or import a receipt photo / PDF — the
          AI extracts the items for you to review before they're added.
        </Text>

        <Text style={styles.label}>PASTE ORDER / RECEIPT TEXT</Text>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Paste items from a Rohlík / Košík / Tesco order or e-mail…"
          placeholderTextColor={colors.textSubtle}
          style={styles.textArea}
          multiline
        />
        <Pressable
          style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.8 }]}
          onPress={fromText}
          disabled={busy != null}
        >
          {busy === 'text' ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <>
              <Icon sf="text.viewfinder" size={16} color={colors.textOnPrimary} />
              <Text style={styles.primaryBtnText}>Extract from text</Text>
            </>
          )}
        </Pressable>

        <Text style={[styles.label, { marginTop: spacing.lg }]}>OR FROM A FILE</Text>
        <Pressable
          style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.7 }]}
          onPress={fromPhoto}
          disabled={busy != null}
        >
          {busy === 'photo' ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Icon sf="photo" size={18} color={colors.primary} />
          )}
          <Text style={styles.secondaryBtnText}>Photo / screenshot</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.7 }]}
          onPress={fromPdf}
          disabled={busy != null}
        >
          {busy === 'pdf' ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Icon sf="doc" size={18} color={colors.primary} />
          )}
          <Text style={styles.secondaryBtnText}>PDF invoice</Text>
        </Pressable>
      </ScrollView>

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
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xs },
  intro: { ...typography.footnote, color: colors.textMuted, marginBottom: spacing.sm, lineHeight: 18 },
  label: { ...typography.label, color: colors.textMuted, marginTop: spacing.sm },
  textArea: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 120,
    textAlignVertical: 'top',
    marginBottom: spacing.sm,
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
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs + 2,
  },
  secondaryBtnText: { ...typography.body, color: colors.text, fontWeight: '600' },
});
