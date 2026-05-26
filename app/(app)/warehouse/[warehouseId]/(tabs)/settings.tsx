// ============================================================================
// Kalta – Warehouse settings tab
// Per-warehouse settings: rename, member management (promote/demote/remove),
// destructive Delete (owner) vs Leave (member / non-last owner) actions.
// Invitation UI lives in Phase 6.
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useGlobalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import {
  buildInviteLink,
  createInvitation,
  deleteWarehouse,
  demoteMember,
  getActiveUserId,
  getWarehouseById,
  leaveWarehouse,
  listMembers,
  promoteMember,
  removeMember,
  renameWarehouse,
  supabase,
} from '@/src/lib/supabase';
import type { Role, Warehouse, WarehouseMember } from '@/src/types/database';
import { colors, radius, spacing, typography } from '@/src/theme';
import { Card } from '@/src/components/Card';
import { Icon } from '@/src/components/Icon';
import { ListHeader } from '@/src/components/ListHeader';
import { WarehouseAlertsBell } from '@/src/components/WarehouseAlertsBell';
import { HouseholdSection } from '@/src/components/HouseholdSection';

const TAB_BAR_HEIGHT = 84;

type MemberWithUser = WarehouseMember & {
  user: { display_name: string | null; email: string | null };
};

function displayNameFor(m: MemberWithUser): string {
  return m.user.display_name ?? m.user.email ?? 'Unknown';
}

export default function WarehouseSettingsScreen() {
  const router = useRouter();
  // Use global search params — local params in nested tab screens don't
  // reliably include parent dynamic segments after a tab switch in Expo Router.
  const { warehouseId } = useGlobalSearchParams<{ warehouseId: string }>();
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);
  const [myRole, setMyRole] = useState<Role | null>(null);
  const [members, setMembers] = useState<MemberWithUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  const load = useCallback(async () => {
    if (!warehouseId) return;
    try {
      setError(null);
      const uid = await getActiveUserId();
      setCurrentUserId(uid);
      if (!uid) return;
      // Fetch the warehouse directly by id — avoids any getMyWarehouses shape
      // quirks. Role is derived from the members list below so we only need
      // one source of truth for role checks.
      const [wh, mem] = await Promise.all([
        getWarehouseById(warehouseId),
        listMembers(warehouseId),
      ]);
      setWarehouse(wh);
      setMembers(mem);
      const self = mem.find((m) => m.user_id === uid);
      setMyRole(self?.role ?? null);
    } catch (e: any) {
      setError(e?.message ?? 'Cannot load warehouse settings.');
      throw e;
    }
  }, [warehouseId]);

  useEffect(() => {
    load()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load]),
  );

  const isOwner = myRole === 'owner';
  const ownerCount = members.filter((m) => m.role === 'owner').length;
  const selfIsLastOwner =
    isOwner &&
    ownerCount === 1 &&
    members.some((m) => m.user_id === currentUserId && m.role === 'owner');

  // ---- Rename ---------------------------------------------------------------

  const handleRename = () => {
    if (!warehouse || !isOwner) return;
    Alert.prompt(
      'Rename warehouse',
      'Enter a new name.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rename',
          onPress: async (text?: string) => {
            const trimmed = (text ?? '').trim();
            if (!trimmed || trimmed === warehouse.name) return;
            try {
              setBusy(true);
              await renameWarehouse(warehouse.id, trimmed);
              await load();
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'Cannot rename.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
      'plain-text',
      warehouse.name,
    );
  };

  // ---- Member management ----------------------------------------------------

  const doPromote = async (member: MemberWithUser) => {
    if (!warehouseId) return;
    try {
      setBusy(true);
      await promoteMember(warehouseId, member.user_id);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Cannot promote.');
    } finally {
      setBusy(false);
    }
  };

  const doDemote = async (member: MemberWithUser) => {
    if (!warehouseId) return;
    try {
      setBusy(true);
      await demoteMember(warehouseId, member.user_id);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Cannot demote.');
    } finally {
      setBusy(false);
    }
  };

  const doRemove = async (member: MemberWithUser) => {
    if (!warehouseId) return;
    try {
      setBusy(true);
      await removeMember(warehouseId, member.user_id);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Cannot remove.');
    } finally {
      setBusy(false);
    }
  };

  const handleMemberTap = (member: MemberWithUser) => {
    // Only owners can manage members. Tapping yourself is a no-op — use the
    // Leave button below instead.
    if (!isOwner) return;
    if (member.user_id === currentUserId) return;

    const isTargetOwner = member.role === 'owner';
    const isLastOwner = isTargetOwner && ownerCount === 1;

    // Build action sheet dynamically. Destructive (Remove) always last before Cancel.
    const options: string[] = [];
    const handlers: Array<() => void> = [];

    if (isTargetOwner) {
      options.push('Demote to member');
      handlers.push(() => {
        if (isLastOwner) {
          Alert.alert(
            'Cannot demote',
            'This is the last owner. Promote another member to owner first.',
          );
          return;
        }
        Alert.alert(
          'Demote to member',
          `${displayNameFor(member)} will lose the ability to rename, delete, or manage members.`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Demote', onPress: () => doDemote(member) },
          ],
        );
      });
    } else {
      options.push('Promote to owner');
      handlers.push(() => {
        Alert.alert(
          'Promote to owner',
          `${displayNameFor(member)} will gain full control — including the ability to delete this warehouse. Continue?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Promote', onPress: () => doPromote(member) },
          ],
        );
      });
    }

    options.push('Remove from warehouse');
    handlers.push(() => {
      if (isLastOwner) {
        Alert.alert(
          'Cannot remove',
          'This is the last owner. Promote another member to owner first.',
        );
        return;
      }
      Alert.alert(
        'Remove member',
        `Remove ${displayNameFor(member)}? They'll lose access immediately.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => doRemove(member),
          },
        ],
      );
    });

    options.push('Cancel');
    const destructiveIdx = options.length - 2;
    const cancelIdx = options.length - 1;

    ActionSheetIOS.showActionSheetWithOptions(
      {
        options,
        destructiveButtonIndex: destructiveIdx,
        cancelButtonIndex: cancelIdx,
        title: displayNameFor(member),
      },
      (i) => {
        if (i !== undefined && i < handlers.length) handlers[i]();
      },
    );
  };

  // ---- Destructive warehouse actions ---------------------------------------

  const handleDelete = () => {
    if (!warehouse || !isOwner) return;
    Alert.alert(
      'Delete warehouse',
      `Really delete "${warehouse.name}"? All boxes and items in this warehouse will be permanently deleted for everyone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setBusy(true);
              await deleteWarehouse(warehouse.id);
              router.replace('/' as any);
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'Cannot delete.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const handleLeave = () => {
    if (!warehouse || !currentUserId) return;
    if (selfIsLastOwner) {
      Alert.alert(
        'You are the last owner',
        'Promote another member to owner first, or delete the warehouse if you no longer need it.',
      );
      return;
    }
    Alert.alert(
      'Leave warehouse',
      `Leave "${warehouse.name}"? You'll lose access to all its boxes and items. Other members keep access.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            try {
              setBusy(true);
              await leaveWarehouse(warehouse.id, currentUserId);
              router.replace('/' as any);
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'Cannot leave.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  // ---- Render ---------------------------------------------------------------

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !warehouse) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Icon brand="warning" size={96} style={{ marginBottom: spacing.lg }} />
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorText}>{error ?? 'Warehouse not found.'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ListHeader
        title={warehouse.name}
        subtitle="Warehouse settings"
        leading={
          <Pressable
            hitSlop={12}
            onPress={() => router.push('/' as any)}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.5 }]}
            accessibilityLabel="Back to warehouses"
          >
            <Icon sf="chevron.left" size={22} color={colors.text} />
          </Pressable>
        }
        actions={
          isOwner
            ? [
                {
                  sfIcon: 'person.badge.plus',
                  onPress: () => setShowInvite(true),
                  label: 'Invite member',
                },
                { sfIcon: 'pencil', onPress: handleRename, label: 'Rename warehouse' },
              ]
            : undefined
        }
        trailing={
          <WarehouseAlertsBell warehouseId={warehouseId} actionsAfterBell={isOwner ? 2 : 0} />
        }
      />

      <FlatList
        data={members}
        keyExtractor={(m) => m.user_id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={<Text style={styles.sectionHeader}>MEMBERS</Text>}
        ListFooterComponent={
          <View style={styles.dangerZone}>
            <Text style={styles.sectionHeader}>READINESS</Text>
            <Pressable
              style={({ pressed }) => [styles.dataBtn, pressed && { opacity: 0.7 }]}
              onPress={() => {
                if (warehouseId) router.push(`/warehouse/${warehouseId}/readiness` as any);
              }}
            >
              <Icon sf="shield.lefthalf.filled" size={18} color={colors.primary} />
              <View style={styles.dataBtnBody}>
                <Text style={styles.dataBtnTitle}>Readiness dashboard</Text>
                <Text style={styles.dataBtnHint}>
                  Coverage, kit checklist, daily needs
                </Text>
              </View>
              <Icon sf="chevron.right" size={14} color={colors.textSubtle} />
            </Pressable>

            {warehouseId ? <HouseholdSection warehouseId={warehouseId} /> : null}

            <Text style={styles.sectionHeader}>DATA</Text>
            <Pressable
              style={({ pressed }) => [styles.dataBtn, pressed && { opacity: 0.7 }]}
              onPress={() => {
                if (warehouseId) {
                  router.push(`/warehouse/${warehouseId}/products` as any);
                }
              }}
            >
              <Icon sf="barcode" size={18} color={colors.primary} />
              <View style={styles.dataBtnBody}>
                <Text style={styles.dataBtnTitle}>Product cache</Text>
                <Text style={styles.dataBtnHint}>Manage cached barcode lookups</Text>
              </View>
              <Icon sf="chevron.right" size={14} color={colors.textSubtle} />
            </Pressable>

            <Text style={styles.sectionHeader}>DANGER ZONE</Text>
            {isOwner && (
              <Pressable
                style={({ pressed }) => [styles.destructiveBtn, pressed && { opacity: 0.7 }]}
                onPress={handleDelete}
                disabled={busy}
              >
                <Icon sf="trash.fill" size={18} color={colors.danger} />
                <Text style={styles.destructiveBtnText}>Delete warehouse</Text>
              </Pressable>
            )}
            <Pressable
              style={({ pressed }) => [
                styles.destructiveBtn,
                selfIsLastOwner && styles.destructiveBtnDisabled,
                pressed && !selfIsLastOwner && { opacity: 0.7 },
              ]}
              onPress={handleLeave}
              disabled={busy}
            >
              <Icon
                sf="rectangle.portrait.and.arrow.right"
                size={18}
                color={selfIsLastOwner ? colors.textSubtle : colors.danger}
              />
              <Text
                style={[
                  styles.destructiveBtnText,
                  selfIsLastOwner && { color: colors.textSubtle },
                ]}
              >
                Leave warehouse
              </Text>
            </Pressable>
            {selfIsLastOwner && (
              <Text style={styles.hint}>
                You're the last owner. Promote another member first to enable Leave.
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <MemberRow
            member={item}
            isCurrentUser={item.user_id === currentUserId}
            tappable={isOwner && item.user_id !== currentUserId}
            onPress={() => handleMemberTap(item)}
          />
        )}
      />

      {busy && (
        <View style={styles.busyOverlay} pointerEvents="none">
          <ActivityIndicator color="#FFFFFF" size="large" />
        </View>
      )}

      <Modal
        visible={showInvite}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowInvite(false)}
      >
        {showInvite && warehouse && currentUserId && warehouseId ? (
          <InviteSheet
            warehouseId={warehouseId}
            warehouseName={warehouse.name}
            invitedBy={currentUserId}
            onClose={() => setShowInvite(false)}
          />
        ) : null}
      </Modal>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// InviteSheet — generate an invitation link + Share / Copy actions
// ---------------------------------------------------------------------------

function InviteSheet({
  warehouseId,
  warehouseName,
  invitedBy,
  onClose,
}: {
  warehouseId: string;
  warehouseName: string;
  invitedBy: string;
  onClose: () => void;
}) {
  const [asCoOwner, setAsCoOwner] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    try {
      setGenerating(true);
      const inv = await createInvitation(
        warehouseId,
        invitedBy,
        asCoOwner ? 'owner' : 'member',
      );
      setLink(buildInviteLink(inv.token));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Cannot create invitation.');
    } finally {
      setGenerating(false);
    }
  };

  const handleShare = async () => {
    if (!link) return;
    try {
      await Share.share({
        message: `Join my Kalta warehouse "${warehouseName}": ${link}`,
        url: link,
      });
    } catch {
      /* user canceled — noop */
    }
  };

  const handleCopy = async () => {
    if (!link) return;
    try {
      await Clipboard.setStringAsync(link);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  return (
    <SafeAreaView style={styles.sheetContainer} edges={['top', 'bottom']}>
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle}>Invite to {warehouseName}</Text>
        <Pressable hitSlop={12} onPress={onClose}>
          <Text style={styles.sheetClose}>Close</Text>
        </Pressable>
      </View>

      {!link ? (
        <ScrollView contentContainerStyle={styles.sheetBody}>
          <Icon
            sf="person.badge.plus"
            size={56}
            color={colors.primary}
            style={styles.sheetIcon}
          />
          <Text style={styles.sheetIntro}>
            Generate a share link. Anyone who taps it joins the warehouse instantly. Links
            expire after 7 days and can only be used once.
          </Text>

          <View style={styles.toggleRow}>
            <View style={styles.toggleText}>
              <Text style={styles.toggleLabel}>Invite as co-owner</Text>
              <Text style={styles.toggleHint}>
                Co-owners can rename, invite, promote/demote, and delete the warehouse.
              </Text>
            </View>
            <Switch
              value={asCoOwner}
              onValueChange={setAsCoOwner}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>

          <Pressable
            style={[styles.btnPrimary, generating && { opacity: 0.7 }]}
            onPress={handleGenerate}
            disabled={generating}
          >
            {generating ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.btnPrimaryText}>Generate link</Text>
            )}
          </Pressable>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.sheetBody}>
          <Icon
            sf="checkmark.circle.fill"
            size={56}
            color={colors.success}
            style={styles.sheetIcon}
          />
          <Text style={styles.sheetSuccessTitle}>Link ready</Text>
          <Text style={styles.sheetIntro}>
            {asCoOwner
              ? "Share this link. The recipient joins as a co-owner."
              : "Share this link. The recipient joins as a member."}
          </Text>

          <Pressable
            onPress={handleCopy}
            style={({ pressed }) => [styles.linkBox, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.linkText} numberOfLines={2}>
              {link}
            </Text>
            <View style={styles.linkCopyRow}>
              <Icon
                sf={copied ? 'checkmark.circle.fill' : 'doc.on.doc'}
                size={14}
                color={copied ? colors.success : colors.primary}
              />
              <Text
                style={[
                  styles.linkCopyHint,
                  copied && { color: colors.success },
                ]}
              >
                {copied ? 'Copied' : 'Tap to copy'}
              </Text>
            </View>
          </Pressable>

          <Pressable style={styles.btnPrimary} onPress={handleShare}>
            <Icon sf="square.and.arrow.up" size={18} color={colors.textOnPrimary} />
            <Text style={styles.btnPrimaryText}>Share</Text>
          </Pressable>

          <Pressable style={styles.btnSecondary} onPress={onClose}>
            <Text style={styles.btnSecondaryText}>Done</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// MemberRow — pill card with avatar circle + name + role badge + ellipsis
// ---------------------------------------------------------------------------

function MemberRow({
  member,
  isCurrentUser,
  tappable,
  onPress,
}: {
  member: MemberWithUser;
  isCurrentUser: boolean;
  tappable: boolean;
  onPress: () => void;
}) {
  const name = displayNameFor(member);
  const email = member.user.email;
  const isOwner = member.role === 'owner';

  return (
    <Card onPress={tappable ? onPress : undefined} style={styles.memberCard}>
      <View style={styles.avatar}>
        <Icon sf="person.fill" size={20} color={colors.primary} />
      </View>
      <View style={styles.memberBody}>
        <Text style={styles.memberName} numberOfLines={1}>
          {name}
          {isCurrentUser ? ' (you)' : ''}
        </Text>
        {email && email !== name ? (
          <Text style={styles.memberEmail} numberOfLines={1}>
            {email}
          </Text>
        ) : null}
      </View>
      <View style={[styles.badge, isOwner ? styles.badgeOwner : styles.badgeMember]}>
        <Text
          style={[styles.badgeText, isOwner ? styles.badgeOwnerText : styles.badgeMemberText]}
        >
          {isOwner ? 'Owner' : 'Member'}
        </Text>
      </View>
      {tappable ? <Icon sf="ellipsis" size={16} color={colors.textSubtle} /> : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
  },
  errorTitle: {
    ...typography.title3,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  errorText: {
    ...typography.subhead,
    color: colors.textMuted,
    textAlign: 'center',
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },

  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: TAB_BAR_HEIGHT + 24,
    gap: spacing.sm,
  },

  sectionHeader: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },

  // Member row
  memberCard: {
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md + 2,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberBody: {
    flex: 1,
    gap: 2,
  },
  memberName: {
    ...typography.headline,
    color: colors.text,
  },
  memberEmail: {
    ...typography.footnote,
    color: colors.textMuted,
  },
  badge: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  badgeOwner: {
    backgroundColor: colors.primaryTint,
  },
  badgeMember: {
    backgroundColor: colors.palette.neutral[100],
  },
  badgeText: {
    ...typography.caption,
    fontWeight: '700',
  },
  badgeOwnerText: {
    color: colors.primary,
  },
  badgeMemberText: {
    color: colors.textMuted,
  },

  // Data section
  dataBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md + 2,
    marginBottom: spacing.md,
  },
  dataBtnBody: { flex: 1, gap: 2 },
  dataBtnTitle: { ...typography.body, color: colors.text, fontWeight: '600' },
  dataBtnHint: { ...typography.footnote, color: colors.textMuted },

  // Danger zone
  dangerZone: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  destructiveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
  },
  destructiveBtnDisabled: {
    opacity: 0.5,
  },
  destructiveBtnText: {
    ...typography.body,
    color: colors.danger,
    fontWeight: '600',
  },
  hint: {
    ...typography.footnote,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    lineHeight: 18,
  },

  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.scrim,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Invite sheet (modal)
  sheetContainer: { flex: 1, backgroundColor: colors.background },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sheetTitle: {
    ...typography.headline,
    color: colors.text,
    flex: 1,
    marginRight: spacing.md,
  },
  sheetClose: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
  sheetBody: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  sheetIcon: {
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  sheetIntro: {
    ...typography.subhead,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.xl,
  },
  sheetSuccessTitle: {
    ...typography.title2,
    color: colors.text,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md + 2,
    marginBottom: spacing.xl,
  },
  toggleText: {
    flex: 1,
    gap: 4,
  },
  toggleLabel: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  toggleHint: {
    ...typography.footnote,
    color: colors.textMuted,
    lineHeight: 18,
  },

  btnPrimary: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
  },
  btnPrimaryText: {
    ...typography.bodyStrong,
    color: colors.textOnPrimary,
  },
  btnSecondary: {
    alignSelf: 'stretch',
    marginTop: spacing.sm,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnSecondaryText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },

  linkBox: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md + 2,
    marginBottom: spacing.xl,
    alignItems: 'center',
  },
  linkText: {
    ...typography.footnote,
    color: colors.text,
    fontFamily: 'Menlo',
    textAlign: 'center',
  },
  linkCopyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  linkCopyHint: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },
});
