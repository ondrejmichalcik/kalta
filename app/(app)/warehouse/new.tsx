// ============================================================================
// Stockr – Create warehouse form
// Sprint 2.7 Phase 4: simple name input → createWarehouse RPC → jump into
// the new warehouse's tab group.
// ============================================================================
import { useState } from 'react';
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
import { useRouter } from 'expo-router';
import { createWarehouse, supabase } from '@/src/lib/supabase';
import { colors, radius, shadows, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';

export default function NewWarehouseScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Name required', 'Give your warehouse a name, e.g. "Home" or "Cottage".');
      return;
    }
    try {
      setSaving(true);
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess.session?.user.id;
      if (!userId) throw new Error('Not signed in.');
      const wh = await createWarehouse(userId, trimmed);
      router.replace(`/warehouse/${wh.id}` as any);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Cannot create warehouse.');
    } finally {
      setSaving(false);
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
        <Text style={styles.topBarTitle}>New warehouse</Text>
        <View style={styles.topBarBtn} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.formScroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Warehouse name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Home"
            placeholderTextColor={colors.textSubtle}
            style={styles.input}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleSave}
          />
          <Text style={styles.hint}>
            A warehouse holds boxes and items. You can share it with other people — they join as
            members or co-owners via an invitation link.
          </Text>

          <Pressable
            style={[styles.btnPrimary, saving && { opacity: 0.7 }]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.btnPrimaryText}>Create warehouse</Text>
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
  hint: {
    ...typography.footnote,
    color: colors.textMuted,
    marginTop: spacing.md,
    lineHeight: 18,
  },
  btnPrimary: {
    marginTop: spacing.xl,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  btnPrimaryText: {
    ...typography.bodyStrong,
    color: colors.textOnPrimary,
  },
});
