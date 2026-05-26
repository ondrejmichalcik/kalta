// ============================================================================
// Kalta – Warehouses list (root of the app stack)
// Shows every warehouse the user belongs to. Empty state prompts them to
// create one or accept a pending invitation. Populated state is a pill card
// list with FAB + New warehouse and a profile icon that opens the sign-out
// menu. Realtime sub on `warehouse_members` keeps the list in sync when
// someone accepts an invitation on another device.
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  getActiveUserId,
  getMyWarehouses,
  listAllItemsInWarehouse,
  subscribeMyWarehouses,
} from '@/src/lib/supabase';
import type { WarehouseWithRole } from '@/src/types/database';
import { daysUntil } from '@/src/types/database';
import { setAppBadge } from '@/src/lib/notifications';
import { colors, radius, spacing, typography } from '@/src/theme';
import { Card } from '@/src/components/Card';
import { FAB } from '@/src/components/FAB';
import { Icon } from '@/src/components/Icon';
import { ResourceIcon } from '@/src/components/ResourceIcon';
import { GlobalAlertsBell } from '@/src/components/GlobalAlertsBell';

export default function WarehousesListScreen() {
  const router = useRouter();
  const [warehouses, setWarehouses] = useState<WarehouseWithRole[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Urgency buckets across all warehouses — drives the attention banner
  // and keeps the app icon badge in sync with live SQLite state every time
  // this screen focuses.

  const load = useCallback(async () => {
    const uid = await getActiveUserId();
    setUserId(uid);
    if (!uid) return;
    const list = await getMyWarehouses(uid);
    setWarehouses(list);

    // App icon badge mirrors the ≤60d count across all warehouses. The
    // header bell loads the same data on its own — we just need the total
    // here to keep the iOS home-screen badge accurate.
    let c60 = 0;
    for (const wh of list) {
      try {
        const items = await listAllItemsInWarehouse(wh.id);
        for (const it of items) {
          if (!it.expiry_date || typeof it.expiry_date !== 'string') continue;
          try {
            const d = daysUntil(it.expiry_date);
            if (Number.isFinite(d) && d <= 60) c60++;
          } catch { /* malformed date — skip */ }
        }
      } catch { /* offline / db-not-ready — skip this warehouse */ }
    }
    setAppBadge(c60).catch(() => {});
  }, []);

  useEffect(() => {
    load()
      .catch((e: any) => setError(e?.message ?? 'Cannot load warehouses.'))
      .finally(() => setLoading(false));
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load]),
  );

  useEffect(() => {
    if (!userId) return;
    const unsubscribe = subscribeMyWarehouses(userId, () => {
      getMyWarehouses(userId).then(setWarehouses).catch(() => {});
    });
    return unsubscribe;
  }, [userId]);

  const openProfile = () => {
    router.push('/profile' as any);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <Icon brand="warning" size={96} style={styles.errorIcon} />
        <Text style={styles.errorTitle}>Something went wrong</Text>
        <Text style={styles.errorText}>{error}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header: large title + alerts bell + profile icon */}
      <View style={styles.header}>
        <Text style={styles.title}>Warehouses</Text>
        <GlobalAlertsBell actionsAfterBell={1} />
        <Pressable
          hitSlop={12}
          onPress={openProfile}
          style={({ pressed }) => [styles.profileBtn, pressed && { opacity: 0.5 }]}
          accessibilityLabel="Profile"
        >
          <Icon sf="person.crop.circle" size={32} color={colors.text} />
        </Pressable>
      </View>

      {warehouses.length === 0 ? (
        <View style={styles.empty}>
          <Icon brand="box-generic" size={120} style={styles.emptyIcon} />
          <Text style={styles.emptyTitle}>No warehouses yet</Text>
          <Text style={styles.emptyText}>
            Create your first warehouse to start organizing boxes and items.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.8 }]}
            onPress={() => router.push('/warehouse/new' as any)}
          >
            <Icon sf="plus" size={18} color={colors.textOnPrimary} />
            <Text style={styles.emptyBtnText}>Create warehouse</Text>
          </Pressable>
          <Text style={styles.emptyHint}>
            If someone invited you, tap the invitation link they shared.
          </Text>
        </View>
      ) : (
        <>
          <FlatList
            data={warehouses}
            keyExtractor={(w) => w.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <WarehouseRow
                warehouse={item}
                onPress={() => router.push(`/warehouse/${item.id}` as any)}
              />
            )}
          />
          <FAB
            label="New warehouse"
            sfIcon="plus"
            bottom={24}
            onPress={() => router.push('/warehouse/new' as any)}
          />
        </>
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// WarehouseRow — pill card with name + role badge + chevron
// ---------------------------------------------------------------------------

function WarehouseRow({
  warehouse,
  onPress,
}: {
  warehouse: WarehouseWithRole;
  onPress: () => void;
}) {
  const isOwner = warehouse.my_role === 'owner';
  return (
    <Card onPress={onPress} style={styles.card}>
      <ResourceIcon table="warehouses" size={40} background={colors.primaryTint} />

      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {warehouse.name}
        </Text>
        <Text style={styles.cardSubtitle} numberOfLines={1}>
          {isOwner ? 'Owner' : 'Member'}
        </Text>
      </View>
      <View style={[styles.badge, isOwner ? styles.badgeOwner : styles.badgeMember]}>
        <Text
          style={[styles.badgeText, isOwner ? styles.badgeOwnerText : styles.badgeMemberText]}
        >
          {isOwner ? 'Owner' : 'Member'}
        </Text>
      </View>
      <Icon sf="chevron.right" size={14} color={colors.textSubtle} />
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
    backgroundColor: colors.background,
    padding: spacing.xxl,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  title: {
    ...typography.largeTitle,
    fontSize: 32,
    lineHeight: 38,
    color: colors.text,
    letterSpacing: -0.5,
    flex: 1,
  },
  profileBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },

  // List
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 100,
    gap: spacing.sm + 2,
  },

  // Attention banners
  card: {
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md + 2,
  },
  cardIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    ...typography.headline,
    color: colors.text,
  },
  cardSubtitle: {
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

  // Empty state
  empty: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: spacing.xxl,
  },
  emptyIcon: { marginBottom: spacing.lg },
  emptyTitle: {
    ...typography.title2,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyText: {
    ...typography.subhead,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.full,
  },
  emptyBtnText: {
    ...typography.bodyStrong,
    color: colors.textOnPrimary,
  },
  emptyHint: {
    ...typography.footnote,
    color: colors.textSubtle,
    textAlign: 'center',
    marginTop: spacing.xl,
    maxWidth: 280,
  },

  // Error
  errorIcon: { marginBottom: spacing.lg },
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
});
