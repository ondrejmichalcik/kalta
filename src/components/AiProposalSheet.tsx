// ============================================================================
// Kalta – AiProposalSheet (Sprint 8)
// Shared review/confirm UI for any AiProposal. Renders the AI's proposal into
// a reviewable, toggle-per-row list; the user includes/excludes rows and
// confirms, and the caller applies the (edited) subset via its own local-first
// writes. The AI's raw output never touches the data directly.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { AiProposal } from '@/src/lib/aiProposal';
import { CATEGORY_LABEL } from '@/src/types/database';
import { colors, radius, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';

interface RowView {
  title: string;
  subtitle: string | null;
}

// Flatten a proposal into uniform display rows (advice has none).
function rowsOf(p: AiProposal): RowView[] {
  switch (p.kind) {
    case 'shopping':
      return p.rows.map((r) => ({
        title: r.label,
        subtitle: [
          r.quantity != null ? `×${r.quantity}` : null,
          r.category ? CATEGORY_LABEL[r.category] : null,
          r.reason,
        ]
          .filter(Boolean)
          .join(' · ') || null,
      }));
    case 'pins':
      return p.matches.map((m) => ({
        title: m.entryLabel,
        subtitle: [`← ${m.itemName}`, m.reason].filter(Boolean).join(' · '),
      }));
    case 'items':
      return p.drafts.map((d) => ({
        title: d.name,
        subtitle: [
          `×${d.quantity}`,
          d.category ? CATEGORY_LABEL[d.category] : null,
          d.estExpiryDays != null ? `~${d.estExpiryDays}d shelf life` : null,
        ]
          .filter(Boolean)
          .join(' · ') || null,
      }));
    case 'advice':
      return [];
  }
}

// Rebuild a proposal keeping only the included row indices.
function withIncluded(p: AiProposal, included: Set<number>): AiProposal {
  switch (p.kind) {
    case 'shopping':
      return { kind: 'shopping', rows: p.rows.filter((_, i) => included.has(i)) };
    case 'pins':
      return { kind: 'pins', matches: p.matches.filter((_, i) => included.has(i)) };
    case 'items':
      return { kind: 'items', drafts: p.drafts.filter((_, i) => included.has(i)) };
    case 'advice':
      return p;
  }
}

export function AiProposalSheet({
  visible,
  proposal,
  title,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  proposal: AiProposal | null;
  title?: string;
  confirmLabel?: string;
  /** Apply the edited (included-only) proposal. Caller does the real writes. */
  onConfirm: (edited: AiProposal) => void | Promise<void>;
  onClose: () => void;
}) {
  const rows = useMemo(() => (proposal ? rowsOf(proposal) : []), [proposal]);
  const [included, setIncluded] = useState<Set<number>>(new Set());
  const [applying, setApplying] = useState(false);

  // Default to everything included whenever a new proposal opens.
  useEffect(() => {
    if (!visible || !proposal) return;
    setIncluded(new Set(rows.map((_, i) => i)));
    setApplying(false);
  }, [visible, proposal, rows]);

  const toggle = (i: number) => {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const isAdvice = proposal?.kind === 'advice';
  const includedCount = included.size;

  const handleConfirm = async () => {
    if (!proposal) return;
    setApplying(true);
    try {
      await onConfirm(isAdvice ? proposal : withIncluded(proposal, included));
      onClose();
    } finally {
      setApplying(false);
    }
  };

  const defaultConfirm = isAdvice ? 'Done' : `Apply${includedCount ? ` (${includedCount})` : ''}`;

  return (
    <Modal
      visible={visible && proposal != null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <Pressable hitSlop={12} onPress={onClose} style={styles.topBarBtn}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {title ?? 'AI suggestions'}
          </Text>
          <Pressable
            hitSlop={12}
            onPress={handleConfirm}
            disabled={applying || (!isAdvice && includedCount === 0)}
            style={styles.topBarBtn}
          >
            {applying ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text
                style={[
                  styles.confirm,
                  !isAdvice && includedCount === 0 && { opacity: 0.4 },
                ]}
              >
                {confirmLabel ?? defaultConfirm}
              </Text>
            )}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scroll}>
          {proposal?.kind === 'advice' ? (
            <Text style={styles.adviceText}>{proposal.text}</Text>
          ) : (
            <>
              <Text style={styles.intro}>
                Review what the AI suggests. Tap to include or exclude, then apply.
              </Text>
              {rows.map((r, i) => {
                const on = included.has(i);
                return (
                  <Pressable
                    key={i}
                    onPress={() => toggle(i)}
                    style={({ pressed }) => [
                      styles.row,
                      on ? styles.rowOn : styles.rowOff,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Icon
                      sf={on ? 'checkmark.circle.fill' : 'circle'}
                      size={20}
                      color={on ? colors.primary : colors.textSubtle}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowTitle, !on && styles.rowDimmed]} numberOfLines={2}>
                        {r.title}
                      </Text>
                      {r.subtitle ? (
                        <Text style={[styles.rowSub, !on && styles.rowDimmed]} numberOfLines={2}>
                          {r.subtitle}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
              {rows.length === 0 && <Text style={styles.intro}>Nothing to apply.</Text>}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  topBarBtn: { minWidth: 64, justifyContent: 'center' },
  title: { ...typography.headline, color: colors.text, flex: 1, textAlign: 'center' },
  cancel: { ...typography.body, color: colors.textMuted },
  confirm: { ...typography.body, color: colors.primary, fontWeight: '700', textAlign: 'right' },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xs + 2 },
  intro: { ...typography.footnote, color: colors.textMuted, marginBottom: spacing.xs, lineHeight: 18 },
  adviceText: { ...typography.body, color: colors.text, lineHeight: 22 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  rowOn: { backgroundColor: colors.surface, borderColor: colors.border },
  rowOff: { backgroundColor: colors.palette.neutral[100], borderColor: colors.border },
  rowTitle: { ...typography.body, color: colors.text, fontWeight: '600' },
  rowSub: { ...typography.footnote, color: colors.textMuted, marginTop: 1 },
  rowDimmed: { opacity: 0.5 },
});
