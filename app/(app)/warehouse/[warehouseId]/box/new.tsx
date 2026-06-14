// ============================================================================
// Kalta – Create new box
// Form → createBox → shows a QR label preview ready to print
// ============================================================================
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { toast } from '@/src/lib/feedback';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { createBox } from '@/src/lib/supabase';
import { printBoxLabel, printBoxLabelViaBrotherSDK } from '@/src/lib/qrLabel';
import type { Box } from '@/src/types/database';
import { colors, radius, shadows, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';

export default function NewBoxScreen() {
  const router = useRouter();
  const { warehouseId } = useLocalSearchParams<{ warehouseId: string }>();
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [createdBox, setCreatedBox] = useState<Box | null>(null);

  const handlePrint = async () => {
    if (!createdBox) return;
    try {
      setPrinting(true);
      await printBoxLabelViaBrotherSDK(createdBox);
    } catch (e: any) {
      toast.error(e?.message ?? 'Cannot print via Brother SDK.');
    } finally {
      setPrinting(false);
    }
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.info('Give the box a name, e.g. "Meds A" or "Water cellar".');
      return;
    }
    if (!warehouseId) {
      toast.error('Missing warehouse context.');
      return;
    }
    try {
      setSaving(true);
      const box = await createBox({
        warehouse_id: warehouseId,
        name: trimmed,
        location: location.trim() || null,
      });
      setCreatedBox(box);
    } catch (e: any) {
      toast.error(e?.message ?? 'Cannot save.');
    } finally {
      setSaving(false);
    }
  };

  // ---- Post-create: QR preview ----
  if (createdBox) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <Pressable
            hitSlop={12}
            onPress={() =>
              router.canGoBack()
                ? router.back()
                : router.replace(`/warehouse/${warehouseId}` as any)
            }
            style={({ pressed }) => [styles.topBarBtn, pressed && { opacity: 0.5 }]}
          >
            <Icon sf="chevron.left" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.topBarTitle}>Box created</Text>
          <View style={styles.topBarBtn} />
        </View>

        <ScrollView contentContainerStyle={styles.qrScroll}>
          {/* Success header */}
          <Icon sf="checkmark.circle.fill" size={48} color={colors.success} />
          <Text style={styles.qrTitle}>{createdBox.name}</Text>
          {createdBox.location ? (
            <View style={styles.qrLocationRow}>
              <Icon sf="mappin" size={14} color={colors.textMuted} />
              <Text style={styles.qrLocation}>{createdBox.location}</Text>
            </View>
          ) : null}

          <View style={styles.qrWrap}>
            <QRCode
              value={createdBox.qr_code}
              size={200}
              backgroundColor="#FFFFFF"
              ecl="H"
              logo={require('@/assets/label-logo.png')}
              logoSize={84}
              logoBackgroundColor="#FFFFFF"
              logoMargin={0}
              logoBorderRadius={10}
            />
          </View>

          <View style={styles.qrHint}>
            <Text style={styles.qrHintText}>
              Print this label and stick it on the box. Scanning the QR code opens the box
              detail instantly.
            </Text>
          </View>

          {/* Primary: Print label */}
          <Pressable
            style={({ pressed }) => [
              styles.btnPrimary,
              printing && { opacity: 0.6 },
              pressed && !printing && { opacity: 0.8 },
            ]}
            onPress={handlePrint}
            disabled={printing}
          >
            {printing ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <View style={styles.btnRow}>
                <Icon sf="printer.fill" size={18} color={colors.textOnPrimary} />
                <Text style={styles.btnPrimaryText}>Print to Brother</Text>
              </View>
            )}
          </Pressable>

          {/* Secondary: Open detail */}
          <Pressable
            style={({ pressed }) => [styles.btnSecondary, pressed && { opacity: 0.7 }]}
            onPress={() =>
              router.replace(`/warehouse/${warehouseId}/box/${createdBox.id}` as any)
            }
          >
            <Text style={styles.btnSecondaryText}>Open box detail</Text>
          </Pressable>

          {/* Tertiary: Back */}
          <Pressable
            style={({ pressed }) => [styles.btnTertiary, pressed && { opacity: 0.5 }]}
            onPress={() =>
              router.canGoBack()
                ? router.back()
                : router.replace(`/warehouse/${warehouseId}` as any)
            }
          >
            <Text style={styles.btnTertiaryText}>Back to boxes</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---- Pre-create: form ----
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
        <Text style={styles.topBarTitle}>New box</Text>
        <View style={styles.topBarBtn} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.formScroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Box name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Meds A"
            placeholderTextColor={colors.textSubtle}
            style={styles.input}
            autoFocus
            returnKeyType="next"
          />

          <Text style={styles.label}>Location (optional)</Text>
          <TextInput
            value={location}
            onChangeText={setLocation}
            placeholder="Shelf 2, row 1"
            placeholderTextColor={colors.textSubtle}
            style={styles.input}
            returnKeyType="done"
            onSubmitEditing={handleSave}
          />

          <Pressable
            style={[styles.btnPrimary, saving && { opacity: 0.7 }]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.btnPrimaryText}>Create box</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
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
  formScroll: {
    padding: spacing.lg,
    gap: spacing.xs,
  },
  label: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: spacing.md,
    marginBottom: spacing.xs + 2,
  },
  input: {
    ...typography.body,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  btnPrimary: {
    marginTop: spacing.xl,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    backgroundColor: colors.primary,
  },
  btnPrimaryText: {
    ...typography.bodyStrong,
    color: colors.textOnPrimary,
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  btnSecondary: {
    marginTop: spacing.sm,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnSecondaryText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  btnTertiary: {
    marginTop: spacing.xs,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnTertiaryText: {
    ...typography.footnote,
    color: colors.textMuted,
    fontWeight: '600',
  },
  // QR preview
  qrScroll: {
    padding: spacing.xl,
    paddingTop: spacing.lg,
    alignItems: 'center',
  },
  qrTitle: {
    ...typography.title1,
    color: colors.text,
    marginTop: spacing.md,
  },
  qrLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  qrLocation: {
    ...typography.footnote,
    color: colors.textMuted,
  },
  qrWrap: {
    marginTop: spacing.xl,
    padding: spacing.xl,
    backgroundColor: '#FFFFFF',
    borderRadius: radius.xl,
    ...shadows.md,
  },
  qrHint: {
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primarySubtle,
    borderRadius: radius.md,
    padding: spacing.md + 2,
    marginTop: spacing.xl,
    alignSelf: 'stretch',
  },
  qrHintText: {
    ...typography.footnote,
    color: colors.successText,
    textAlign: 'center',
  },
});
