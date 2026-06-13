// ============================================================================
// Kalta – Custom checklists list (Sprint 7)
// Per-warehouse readiness checklists. Seeds the FEMA kit on first visit, lets
// the user create custom lists, and routes into each list's detail/editor.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  addWarehouseChecklist,
  deleteChecklist,
  listWarehouseChecklists,
  removeWarehouseChecklist,
  subscribeChecklists,
} from '@/src/lib/supabase';
import { ensureSeededChecklists } from '@/src/lib/checklists';
import { ChecklistSheet } from '@/src/components/ChecklistSheet';
import type { Checklist } from '@/src/types/database';
import { colors, radius, shadows, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';

export default function ChecklistsScreen() {
  const router = useRouter();
  const { warehouseId } = useLocalSearchParams<{ warehouseId: string }>();
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    if (!warehouseId) return;
    try {
      const rows = await ensureSeededChecklists(warehouseId);
      setChecklists(rows);
      const links = await listWarehouseChecklists(warehouseId).catch(() => []);
      setLinkedIds(new Set(links.map((l) => l.checklist_id)));
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }, [warehouseId]);

  const toggleApplies = (checklistId: string, applies: boolean) => {
    if (!warehouseId) return;
    const op = applies
      ? removeWarehouseChecklist(warehouseId, checklistId)
      : addWarehouseChecklist({ warehouse_id: warehouseId, checklist_id: checklistId });
    op.then(load).catch((e: any) => Alert.alert('Error', e?.message ?? 'Could not update.'));
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    if (!warehouseId) return;
    return subscribeChecklists(warehouseId, () => load());
  }, [warehouseId, load]);

  const goToChecklist = (id: string) =>
    router.push(`/warehouse/${warehouseId}/checklist/${id}` as any);

  const createNew = () => setCreateOpen(true);

  // Track the open swipeable so opening one closes another (matches box detail).
  const openSwipeableRef = useRef<Swipeable | null>(null);

  const handleDeleteChecklist = (c: Checklist, close: () => void) => {
    Alert.alert('Delete checklist', `Delete "${c.name}" and all its items?`, [
      { text: 'Cancel', style: 'cancel', onPress: close },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          deleteChecklist(c.id)
            .then(() => {
              close();
              load();
            })
            .catch((e: any) => Alert.alert('Error', e?.message ?? 'Could not delete.')),
      },
    ]);
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
        <Text style={styles.topBarTitle}>Checklists</Text>
        <Pressable
          hitSlop={12}
          onPress={createNew}
          style={({ pressed }) => [styles.topBarBtn, pressed && { opacity: 0.5 }]}
        >
          <Icon sf="plus" size={22} color={colors.primary} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.intro}>
            Pick what your warehouse should be ready for. The FEMA kit is here by default —
            add your own lists for anything else.
          </Text>
          {checklists.map((c) => (
            <ChecklistRow
              key={c.id}
              checklist={c}
              applies={linkedIds.has(c.id)}
              onOpen={() => router.push(`/warehouse/${warehouseId}/checklist/${c.id}` as any)}
              onToggle={() => toggleApplies(c.id, linkedIds.has(c.id))}
              onDelete={(close) => handleDeleteChecklist(c, close)}
              registerOpen={(ref) => {
                if (openSwipeableRef.current && openSwipeableRef.current !== ref) {
                  openSwipeableRef.current.close();
                }
                openSwipeableRef.current = ref;
              }}
            />
          ))}

          <Pressable
            style={({ pressed }) => [styles.newBtn, pressed && { opacity: 0.7 }]}
            onPress={createNew}
          >
            <Icon sf="plus.circle.fill" size={18} color={colors.primary} />
            <Text style={styles.newBtnText}>New checklist</Text>
          </Pressable>
        </ScrollView>
      )}

      <ChecklistSheet
        visible={createOpen}
        mode="create"
        warehouseId={warehouseId ?? ''}
        sources={checklists}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => goToChecklist(id)}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// ChecklistRow — swipe-left reveals Delete (custom lists only; the FEMA seed
// can't be deleted, so it renders without a swipe action).
// ---------------------------------------------------------------------------
function ChecklistRow({
  checklist: c,
  applies,
  onOpen,
  onToggle,
  onDelete,
  registerOpen,
}: {
  checklist: Checklist;
  applies: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onDelete: (close: () => void) => void;
  registerOpen: (ref: Swipeable | null) => void;
}) {
  const swipeRef = useRef<Swipeable>(null);

  const card = (
    <View style={styles.card}>
      <Pressable
        style={({ pressed }) => [styles.cardMain, pressed && { opacity: 0.6 }]}
        onPress={onOpen}
      >
        <Icon
          sf={c.is_seed ? 'shield.lefthalf.filled' : 'checklist'}
          size={22}
          color={colors.primary}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{c.name}</Text>
          {c.is_seed && <Text style={styles.cardSub}>Default kit</Text>}
        </View>
        <Icon sf="chevron.right" size={14} color={colors.textSubtle} />
      </Pressable>
      <Pressable
        hitSlop={8}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.applyToggle,
          applies ? styles.applyOn : styles.applyOff,
          pressed && { opacity: 0.7 },
        ]}
      >
        <Icon
          sf={applies ? 'checkmark.circle.fill' : 'circle'}
          size={13}
          color={applies ? colors.primary : colors.textSubtle}
        />
        <Text style={[styles.applyText, { color: applies ? colors.primary : colors.textSubtle }]}>
          {applies ? 'On readiness' : 'Not on readiness'}
        </Text>
      </Pressable>
    </View>
  );

  if (c.is_seed) return card;

  return (
    <Swipeable
      ref={swipeRef}
      renderRightActions={() => (
        <Pressable
          style={styles.deleteAction}
          onPress={() => onDelete(() => swipeRef.current?.close())}
        >
          <Icon sf="trash.fill" size={20} color="#FFFFFF" />
          <Text style={styles.deleteActionText}>Delete</Text>
        </Pressable>
      )}
      rightThreshold={40}
      overshootRight={false}
      onSwipeableWillOpen={() => registerOpen(swipeRef.current)}
    >
      {card}
    </Swipeable>
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
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  intro: { ...typography.footnote, color: colors.textMuted, marginBottom: spacing.sm, lineHeight: 18 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md + 2,
    gap: spacing.sm,
    ...shadows.sm,
  },
  cardMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardTitle: { ...typography.body, color: colors.text, fontWeight: '700' },
  cardSub: { ...typography.footnote, color: colors.textMuted, marginTop: 2 },
  applyToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  applyOn: { backgroundColor: colors.primaryTint, borderColor: colors.primarySubtle },
  applyOff: { backgroundColor: colors.palette.neutral[100], borderColor: colors.border },
  applyText: { ...typography.caption, fontWeight: '700' },
  deleteAction: {
    backgroundColor: colors.danger,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
    width: 88,
    borderTopRightRadius: radius.md,
    borderBottomRightRadius: radius.md,
  },
  deleteActionText: { ...typography.caption, color: '#FFFFFF', fontWeight: '700' },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    marginTop: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.primarySubtle,
    backgroundColor: colors.primaryTint,
  },
  newBtnText: { ...typography.subhead, color: colors.primary, fontWeight: '700' },
});
