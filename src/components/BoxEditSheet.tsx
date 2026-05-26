// ============================================================================
// Kalta – BoxEditSheet
// Modal-like sheet for editing an existing box (name, location).
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
import { updateBox } from '@/src/lib/supabase';
import type { Box } from '@/src/types/database';
import { colors, radius, spacing, typography } from '@/src/theme';

export interface BoxEditSheetProps {
  box: Box;
  onClose: () => void;
  onSaved: (updated: Box) => void;
}

export function BoxEditSheet({ box, onClose, onSaved }: BoxEditSheetProps) {
  const [name, setName] = useState(box.name);
  const [location, setLocation] = useState(box.location ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(box.name);
    setLocation(box.location ?? '');
  }, [box.id]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Name required', 'The box needs a name.');
      return;
    }
    try {
      setSaving(true);
      const updated = await updateBox(box.id, {
        name: trimmed,
        location: location.trim() || null,
      });
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
        <Text style={styles.headerTitle}>Edit box</Text>
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
          <Text style={styles.label}>Box name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Meds A"
            placeholderTextColor={colors.textSubtle}
            style={styles.input}
            autoFocus
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
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
    paddingVertical: spacing.md + 2,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
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
});
