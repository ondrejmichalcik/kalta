// ============================================================================
// Kalta – Profile / global settings
// Per-device settings that don't belong to a single warehouse: signed-in
// user, Anthropic API key for Claude Vision, sign out. Pushed from the
// profile icon on the Warehouses list screen.
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Network from 'expo-network';
import { getActiveUser, signOut, supabase } from '@/src/lib/supabase';
import {
  clearAnthropicKey,
  getAnthropicKey,
  setAnthropicKey,
} from '@/src/lib/secureStore';
import { testAnthropicKey } from '@/src/lib/vision';
import {
  ALL_WINDOWS,
  getReminderWindows,
  isNotificationsEnabled,
  setNotificationsEnabled,
  setReminderWindows,
  type ReminderWindow,
} from '@/src/lib/notifications';
import { colors, radius, shadows, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';

export default function ProfileScreen() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [keyStatus, setKeyStatus] = useState<'loading' | 'absent' | 'present'>('loading');
  const [testing, setTesting] = useState(false);
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [activeWindows, setActiveWindows] = useState<ReminderWindow[]>([...ALL_WINDOWS]);

  const loadProfile = useCallback(async () => {
    const user = await getActiveUser();
    if (user) {
      setEmail(user.email);
      // Try local SQLite first so offline continue shows the user's
      // identity; fall back to the server only if we didn't have the
      // row cached. Email may have been null in cachedUser (offline
      // continue doesn't stash it), so recover it from the local row.
      let localEmail: string | null = null;
      let localName: string | null = null;
      try {
        const { getDb } = await import('@/src/lib/localDb');
        const row = getDb().getFirstSync<{ email: string | null; display_name: string | null }>(
          'SELECT email, display_name FROM users WHERE id = ?', [user.id],
        );
        if (row) {
          localEmail = row.email;
          localName = row.display_name;
        }
      } catch { /* db not ready */ }
      if (localEmail) setEmail(localEmail);
      if (localName) setDisplayName(localName);
      // Online refresh — overwrites with server value if reachable.
      try {
        const { data } = await supabase
          .from('users')
          .select('display_name, email')
          .eq('id', user.id)
          .maybeSingle();
        const d = data as { display_name: string | null; email: string | null } | null;
        if (d?.email) setEmail(d.email);
        if (d?.display_name) setDisplayName(d.display_name);
      } catch { /* offline, ignore */ }
    }
    const key = await getAnthropicKey();
    setKeyStatus(key ? 'present' : 'absent');
    const notif = await isNotificationsEnabled();
    setNotifEnabled(notif);
    const windows = await getReminderWindows();
    setActiveWindows(windows);
  }, []);

  useEffect(() => {
    loadProfile().catch(() => {});
  }, [loadProfile]);

  useFocusEffect(
    useCallback(() => {
      loadProfile().catch(() => {});
    }, [loadProfile]),
  );

  // ---- Contact email override ----------------------------------------------
  // Apple Sign In with "Hide My Email" returns an ...@privaterelay.appleid.com
  // address — the user's real email is never shared with us. This lets the
  // user manually store a contact email (display-only, doesn't affect auth).
  // Stored in public.users.email; when offline the update queues via the
  // standard sync path once connectivity returns.
  const promptForEmail = () => {
    Alert.prompt(
      'Contact email',
      'Apple "Hide My Email" gave us a relay address. You can enter your real email here for display. Auth keeps using Apple Sign In — this is purely cosmetic.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: async (text?: string) => {
            const trimmed = (text ?? '').trim();
            if (!trimmed) return;
            const user = await getActiveUser();
            if (!user) return;
            try {
              // Update local SQLite first so UI reflects immediately.
              const { getDb } = await import('@/src/lib/localDb');
              getDb().runSync(
                'UPDATE users SET email = ? WHERE id = ?',
                [trimmed, user.id],
              );
              setEmail(trimmed);
              // Push to server — silent failure is OK, user sees local value.
              supabase
                .from('users')
                .update({ email: trimmed })
                .eq('id', user.id)
                .then(() => {}, () => {});
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'Cannot save email.');
            }
          },
        },
      ],
      'plain-text',
      email ?? '',
      'email-address',
    );
  };

  // ---- API key management --------------------------------------------------

  const promptForKey = (existing?: string) => {
    Alert.prompt(
      existing ? 'Change API key' : 'Set Anthropic API key',
      'Paste your Anthropic API key from console.anthropic.com. It stays on this device — we never send it to our servers.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: async (text?: string) => {
            const trimmed = (text ?? '').trim();
            if (!trimmed) return;
            if (!trimmed.startsWith('sk-ant-')) {
              Alert.alert(
                'Invalid format',
                'Anthropic API keys start with "sk-ant-". Double-check you copied the full key.',
              );
              return;
            }
            try {
              await setAnthropicKey(trimmed);
              setKeyStatus('present');
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'Cannot save key.');
            }
          },
        },
      ],
      'secure-text',
      '',
    );
  };

  const handleTestKey = async () => {
    try {
      setTesting(true);
      const key = await getAnthropicKey();
      if (!key) {
        Alert.alert('No key', 'Set an API key first.');
        return;
      }
      await testAnthropicKey(key);
      Alert.alert('Key works', 'Successfully connected to api.anthropic.com.');
    } catch (e: any) {
      Alert.alert('Key test failed', e?.message ?? 'Unknown error.');
    } finally {
      setTesting(false);
    }
  };

  const handleRemoveKey = () => {
    Alert.alert(
      'Remove API key',
      'Claude Vision identification will stop working on this device until you set a new key.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await clearAnthropicKey();
            setKeyStatus('absent');
          },
        },
      ],
    );
  };

  // ---- Sign out ------------------------------------------------------------

  const handleSignOut = async () => {
    // Block sign out when offline — login requires Apple Sign In which needs internet.
    // Without internet the user would be permanently locked out.
    try {
      const state = await Network.getNetworkStateAsync();
      if (!state.isConnected || !state.isInternetReachable) {
        Alert.alert(
          'You are offline',
          'Signing back in requires internet (Apple Sign In). You can still use "Continue offline" on the login screen to access your local data.',
          [
            { text: 'Stay signed in', style: 'cancel' },
            {
              text: 'Sign out anyway',
              style: 'destructive',
              onPress: () => { signOut().catch(() => {}); },
            },
          ],
        );
        return;
      }
    } catch { /* can't check — let them proceed with warning */ }

    Alert.alert(
      'Sign out',
      'You will need internet and Apple Sign In to log back in. Your local data will be kept on this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: () => {
            signOut().catch(() => {});
          },
        },
      ],
    );
  };

  // ---- Render --------------------------------------------------------------

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
        <Text style={styles.topBarTitle}>Profile</Text>
        <View style={styles.topBarBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Account card */}
        <Text style={styles.sectionHeader}>ACCOUNT</Text>
        <Pressable
          style={({ pressed }) => [styles.card, styles.accountCardRow, pressed && { opacity: 0.7 }]}
          onPress={promptForEmail}
        >
          <View style={styles.avatar}>
            <Icon sf="person.fill" size={24} color={colors.primary} />
          </View>
          <View style={[styles.accountBody, { flex: 1 }]}>
            <Text style={styles.accountName} numberOfLines={1}>
              {displayName ?? email ?? 'Signed in'}
            </Text>
            {email && displayName && email !== displayName ? (
              <Text style={styles.accountEmail} numberOfLines={1}>
                {email}
              </Text>
            ) : null}
          </View>
          <Icon sf="pencil" size={16} color={colors.textSubtle} />
        </Pressable>

        {/* Claude Vision section */}
        <Text style={styles.sectionHeader}>CLAUDE VISION</Text>
        <View style={styles.card}>
          <View style={styles.visionIntro}>
            <Icon sf="sparkles" size={20} color={colors.primary} />
            <Text style={styles.visionTitle}>AI product identification</Text>
          </View>
          <Text style={styles.visionDescription}>
            Identify products by photo when barcode lookup comes up empty. Needs your own
            Anthropic API key from console.anthropic.com — it stays on this device, not on
            our servers.
          </Text>

          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                keyStatus === 'present'
                  ? { backgroundColor: colors.success }
                  : { backgroundColor: colors.textSubtle },
              ]}
            />
            <Text style={styles.statusText}>
              {keyStatus === 'loading'
                ? 'Checking…'
                : keyStatus === 'present'
                  ? 'API key configured'
                  : 'No API key set'}
            </Text>
          </View>

          {keyStatus === 'present' ? (
            <View style={styles.actionRow}>
              <Pressable
                style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]}
                onPress={() => promptForKey('exists')}
              >
                <Text style={styles.actionBtnText}>Change</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]}
                onPress={handleTestKey}
                disabled={testing}
              >
                {testing ? (
                  <ActivityIndicator color={colors.text} />
                ) : (
                  <Text style={styles.actionBtnText}>Test</Text>
                )}
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.actionBtn,
                  styles.actionBtnDestructive,
                  pressed && { opacity: 0.7 },
                ]}
                onPress={handleRemoveKey}
              >
                <Text style={styles.actionBtnDestructiveText}>Remove</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.8 }]}
              onPress={() => promptForKey()}
            >
              <Icon sf="key.fill" size={16} color={colors.textOnPrimary} />
              <Text style={styles.primaryBtnText}>Set API key</Text>
            </Pressable>
          )}
        </View>

        {/* Notifications */}
        <Text style={styles.sectionHeader}>NOTIFICATIONS</Text>
        <View style={styles.card}>
          <View style={styles.notifRow}>
            <View style={styles.notifText}>
              <Text style={styles.visionTitle}>Expiry reminders</Text>
              <Text style={styles.visionDescription}>
                Local notifications for items approaching expiry. Works offline.
              </Text>
            </View>
            <Switch
              value={notifEnabled}
              onValueChange={async (val) => {
                setNotifEnabled(val);
                await setNotificationsEnabled(val);
              }}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>

          {notifEnabled && (
            <View style={styles.windowsSection}>
              <Text style={styles.windowsLabel}>Remind me</Text>
              {ALL_WINDOWS.map((w) => {
                const enabled = activeWindows.includes(w);
                const label = w === 0 ? 'On expiry day' : w === 1 ? '1 day before' : `${w} days before`;
                return (
                  <Pressable
                    key={w}
                    style={styles.windowRow}
                    onPress={async () => {
                      const next = enabled
                        ? activeWindows.filter((x) => x !== w)
                        : [...activeWindows, w].sort((a, b) => b - a);
                      setActiveWindows(next);
                      await setReminderWindows(next);
                    }}
                  >
                    <Icon
                      sf={enabled ? 'checkmark.circle.fill' : 'circle'}
                      size={20}
                      color={enabled ? colors.primary : colors.textMuted}
                    />
                    <Text style={[styles.windowText, !enabled && { color: colors.textMuted }]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {/* P2P Sync */}
        <Text style={styles.sectionHeader}>DEVICE SYNC</Text>
        <Pressable
          style={({ pressed }) => [styles.p2pBtn, pressed && { opacity: 0.7 }]}
          onPress={() => router.push('/p2p-sync' as any)}
        >
          <View style={styles.p2pIconWrap}>
            <Icon sf="antenna.radiowaves.left.and.right" size={20} color={colors.primary} />
          </View>
          <View style={styles.p2pText}>
            <Text style={styles.visionTitle}>Sync with nearby iPhone</Text>
            <Text style={styles.visionDescription}>
              Exchange data via Bluetooth/WiFi. No internet needed.
            </Text>
          </View>
          <Icon sf="chevron.right" size={14} color={colors.textSubtle} />
        </Pressable>

        {/* Sign out */}
        <Text style={styles.sectionHeader}>SESSION</Text>
        <Pressable
          style={({ pressed }) => [styles.signOutBtn, pressed && { opacity: 0.7 }]}
          onPress={handleSignOut}
        >
          <Icon sf="rectangle.portrait.and.arrow.right" size={18} color={colors.danger} />
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
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
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
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

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.sm,
  },

  accountCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  // Account row
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountBody: { gap: 2 },
  accountName: {
    ...typography.headline,
    color: colors.text,
  },
  accountEmail: {
    ...typography.footnote,
    color: colors.textMuted,
  },

  // Vision section
  visionIntro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  visionTitle: {
    ...typography.headline,
    color: colors.text,
  },
  visionDescription: {
    ...typography.footnote,
    color: colors.textMuted,
    lineHeight: 19,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusText: {
    ...typography.footnote,
    color: colors.text,
    fontWeight: '600',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.md,
  },
  primaryBtnText: {
    ...typography.bodyStrong,
    color: colors.textOnPrimary,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: {
    ...typography.footnote,
    color: colors.text,
    fontWeight: '700',
  },
  actionBtnDestructive: {
    borderColor: colors.dangerBgStrong,
    backgroundColor: colors.dangerBg,
  },
  actionBtnDestructiveText: {
    ...typography.footnote,
    color: colors.danger,
    fontWeight: '700',
  },

  // Notifications
  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  notifText: {
    flex: 1,
    gap: 4,
  },
  windowsSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.xs,
  },
  windowsLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  windowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs + 1,
  },
  windowText: {
    ...typography.body,
    color: colors.text,
  },

  // P2P Sync
  p2pBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md + 2,
  },
  p2pIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  p2pText: {
    flex: 1,
    gap: 4,
  },

  // Sign out
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
  },
  signOutText: {
    ...typography.body,
    color: colors.danger,
    fontWeight: '600',
  },
});
