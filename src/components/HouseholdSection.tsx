// ============================================================================
// Kalta – Household section (Sprint 6 readiness)
// Lives in warehouse settings. Lists household members with per-person
// daily calorie + water needs, lets the user add/edit/remove people, and
// sets the readiness goal (days). Feeds the readiness dashboard.
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import * as Haptics from 'expo-haptics';
import {
  addHouseholdMember,
  deleteHouseholdMember,
  getWarehouseById,
  listHouseholdMembers,
  setReadinessGoal,
  updateHouseholdMember,
} from '@/src/lib/supabase';
import {
  DAILY_NEED_PRESETS,
  type HouseholdMember,
} from '@/src/types/database';
import { colors, radius, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';

const GOAL_PRESETS: Array<{ label: string; days: number }> = [
  { label: '72 hours', days: 3 },
  { label: '2 weeks', days: 14 },
  { label: '1 month', days: 30 },
  { label: '3 months', days: 90 },
];

export function HouseholdSection({ warehouseId }: { warehouseId: string }) {
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [goalDays, setGoalDays] = useState(14);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<HouseholdMember | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, wh] = await Promise.all([
        listHouseholdMembers(warehouseId),
        getWarehouseById(warehouseId),
      ]);
      setMembers(m);
      if (wh) setGoalDays(wh.readiness_goal_days ?? 14);
    } catch {
      // non-fatal
    }
  }, [warehouseId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const totalKcal = members.reduce((s, m) => s + m.daily_kcal, 0);
  const totalWater = members.reduce((s, m) => s + m.daily_water_l, 0);

  const handleDelete = (m: HouseholdMember) => {
    Alert.alert('Remove person', `Remove ${m.name} from the household?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteHouseholdMember(m.id);
            setMembers((prev) => prev.filter((x) => x.id !== m.id));
          } catch (e: any) {
            Alert.alert('Error', e?.message ?? 'Cannot remove.');
          }
        },
      },
    ]);
  };

  const handleSetGoal = (days: number) => {
    setGoalDays(days);
    setReadinessGoal(warehouseId, days).catch(() => {});
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.sectionHeader}>HOUSEHOLD</Text>
      <Text style={styles.hint}>
        Who these supplies feed. Used to compute how many days of food and
        water you have.
      </Text>

      {members.map((m) => (
        <Pressable
          key={m.id}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
          onPress={() => setEditing(m)}
        >
          <View style={styles.rowBody}>
            <Text style={styles.rowName}>{m.name}</Text>
            <Text style={styles.rowMeta}>
              {m.daily_kcal} kcal · {m.daily_water_l} L / day
            </Text>
          </View>
          <Pressable
            onPress={() => handleDelete(m)}
            hitSlop={12}
            style={({ pressed }) => [styles.delBtn, pressed && { opacity: 0.5 }]}
          >
            <Icon sf="trash" size={16} color={colors.danger} />
          </Pressable>
        </Pressable>
      ))}

      <Pressable
        style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.7 }]}
        onPress={() => setEditing('new')}
      >
        <Icon sf="plus" size={16} color={colors.primary} />
        <Text style={styles.addBtnText}>Add person</Text>
      </Pressable>

      {members.length > 0 ? (
        <Text style={styles.total}>
          Total: {totalKcal} kcal · {totalWater.toFixed(1)} L / day
        </Text>
      ) : null}

      {/* Readiness goal */}
      <Text style={[styles.sectionHeader, { marginTop: spacing.lg }]}>
        READINESS GOAL
      </Text>
      <Text style={styles.hint}>
        How many days of supplies you're aiming for. Drives the readiness
        color coding.
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {GOAL_PRESETS.map((g) => {
          const active = goalDays === g.days;
          return (
            <Pressable
              key={g.days}
              onPress={() => handleSetGoal(g.days)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {g.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <MemberSheet
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
        warehouseId={warehouseId}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Add/edit member sheet

function MemberSheet({
  target,
  warehouseId,
  onClose,
  onSaved,
}: {
  target: HouseholdMember | 'new' | null;
  warehouseId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('2000');
  const [water, setWater] = useState('3');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (target === 'new') {
      setName('');
      setKcal('2000');
      setWater('3');
    } else if (target) {
      setName(target.name);
      setKcal(String(target.daily_kcal));
      setWater(String(target.daily_water_l));
    }
  }, [target]);

  if (!target) return null;

  const applyPreset = (p: (typeof DAILY_NEED_PRESETS)[number]) => {
    setKcal(String(p.daily_kcal));
    setWater(String(p.daily_water_l));
    Haptics.selectionAsync().catch(() => {});
  };

  // A preset is "active" when both current values exactly match it. If the
  // user tweaks kcal or water manually, the chip auto-deselects.
  const kcalN = parseInt(kcal, 10);
  const waterN = parseFloat(water.replace(',', '.'));
  const activePresetLabel = DAILY_NEED_PRESETS.find(
    (p) => p.daily_kcal === kcalN && p.daily_water_l === waterN,
  )?.label;

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Name required', 'Please enter a name.');
      return;
    }
    const kcalN = parseInt(kcal, 10);
    const waterN = parseFloat(water.replace(',', '.'));
    if (!Number.isFinite(kcalN) || kcalN <= 0) {
      Alert.alert('Invalid calories', 'Enter a positive number.');
      return;
    }
    if (!Number.isFinite(waterN) || waterN <= 0) {
      Alert.alert('Invalid water', 'Enter a positive number.');
      return;
    }
    try {
      setSaving(true);
      if (target === 'new') {
        await addHouseholdMember({
          warehouse_id: warehouseId,
          name: trimmed,
          daily_kcal: kcalN,
          daily_water_l: waterN,
        });
      } else {
        await updateHouseholdMember(target.id, {
          name: trimmed,
          daily_kcal: kcalN,
          daily_water_l: waterN,
        });
      }
      onSaved();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Cannot save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={target != null}
      presentationStyle="pageSheet"
      animationType="slide"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.sheet} edges={['top']}>
        <View style={styles.sheetHeader}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.sheetBtn}>Cancel</Text>
          </Pressable>
          <Text style={styles.sheetTitle}>
            {target === 'new' ? 'Add person' : 'Edit person'}
          </Text>
          <Pressable onPress={handleSave} hitSlop={12} disabled={saving}>
            {saving ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={[styles.sheetBtn, styles.sheetBtnPrimary]}>Save</Text>
            )}
          </Pressable>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Ondřej"
              placeholderTextColor={colors.textSubtle}
              autoCapitalize="words"
            />

            <Text style={styles.label}>Quick preset</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {DAILY_NEED_PRESETS.map((p) => {
                const active = p.label === activePresetLabel;
                return (
                  <Pressable
                    key={p.label}
                    onPress={() => applyPreset(p)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text
                      style={[styles.chipText, active && styles.chipTextActive]}
                    >
                      {p.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Text style={styles.label}>Calories per day (kcal)</Text>
            <TextInput
              style={styles.input}
              value={kcal}
              onChangeText={setKcal}
              keyboardType="number-pad"
              placeholder="2000"
              placeholderTextColor={colors.textSubtle}
            />

            <Text style={styles.label}>Water per day (L)</Text>
            <TextInput
              style={styles.input}
              value={water}
              onChangeText={setWater}
              keyboardType="decimal-pad"
              placeholder="3"
              placeholderTextColor={colors.textSubtle}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: spacing.xl, alignItems: 'center' },
  sectionHeader: {
    ...typography.footnote,
    color: colors.textMuted,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  hint: {
    ...typography.footnote,
    color: colors.textSubtle,
    marginBottom: spacing.sm,
    lineHeight: 18,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowBody: { flex: 1, gap: 2 },
  rowName: { ...typography.headline, color: colors.text },
  rowMeta: { ...typography.footnote, color: colors.textMuted },
  delBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  addBtnText: { ...typography.body, color: colors.primary, fontWeight: '600' },
  total: {
    ...typography.subhead,
    color: colors.text,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  chipRow: { flexDirection: 'row', gap: 6, paddingVertical: 2 },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.footnote, color: colors.text },
  chipTextActive: { color: colors.textOnPrimary, fontWeight: '600' },
  // Sheet
  sheet: { flex: 1, backgroundColor: colors.background },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  sheetTitle: { ...typography.headline, color: colors.text },
  sheetBtn: { ...typography.body, color: colors.text },
  sheetBtnPrimary: { color: colors.primary, fontWeight: '600' },
  sheetBody: { padding: spacing.lg, gap: spacing.sm },
  label: {
    ...typography.footnote,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.md,
  },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
