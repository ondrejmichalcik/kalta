// ============================================================================
// Stockr – Login (Apple Sign In + dev email fallback)
// ============================================================================
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { signInWithApple, supabase } from '@/src/lib/supabase';
import { hasInitialSync } from '@/src/lib/sync';
import { colors, radius, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';

const CACHED_USER_KEY = 'stockr:cachedUser';
const LAST_USER_KEY = 'stockr:lastUser';

export default function LoginScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [devEmail, setDevEmail] = useState('');
  const [devPassword, setDevPassword] = useState('');
  const [devLoading, setDevLoading] = useState(false);
  // Show "Continue offline" when local data exists from a previous session
  const [canContinueOffline, setCanContinueOffline] = useState(false);
  const [offlineUserId, setOfflineUserId] = useState<string | null>(null);

  useEffect(() => {
    // Check if we have local SQLite data AND a last known user identity.
    // lastUser survives sign-out (unlike cachedUser) so the user can
    // recover access to their local data without internet.
    if (hasInitialSync()) {
      AsyncStorage.getItem(LAST_USER_KEY).then((raw) => {
        if (raw) {
          const u = JSON.parse(raw);
          setOfflineUserId(u.id);
          setCanContinueOffline(true);
        }
      }).catch(() => {});
    }
  }, []);

  const handleContinueOffline = async () => {
    if (!offlineUserId) return;
    // Re-persist cachedUser so auth guard lets us through
    await AsyncStorage.setItem(
      CACHED_USER_KEY,
      JSON.stringify({ id: offlineUserId, email: null }),
    );
    router.replace('/' as any);
  };

  const handleAppleSignIn = async () => {
    try {
      setLoading(true);

      // Nonce pro Supabase ID token sign-in
      const rawNonce = Crypto.randomUUID();
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce,
      );

      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });

      if (!credential.identityToken) {
        throw new Error('Apple did not return an identity token.');
      }

      const { data, error } = await signInWithApple(credential.identityToken, rawNonce);
      if (error) throw error;
      if (!data.session) throw new Error('Sign in failed.');

      // Update display_name from Apple credential (only on first sign in)
      if (credential.fullName?.givenName) {
        const displayName = [credential.fullName.givenName, credential.fullName.familyName]
          .filter(Boolean)
          .join(' ');
        await supabase
          .from('users')
          .update({ display_name: displayName })
          .eq('id', data.session.user.id);
      }

      // After sign-in the auth guard routes to `/`, which is the Warehouses
      // list. An empty list shows onboarding; invited users see shared
      // warehouses populate via realtime sub.
    } catch (e: any) {
      if (e?.code === 'ERR_REQUEST_CANCELED') return;
      Alert.alert('Sign in error', e?.message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  // --------------------------------------------------------------------------
  // DEV ONLY: Email + password login to bypass Apple Sign In in the simulator.
  // This block is not rendered in production builds (__DEV__ === false).
  // --------------------------------------------------------------------------
  const handleDevLogin = async () => {
    const email = devEmail.trim();
    const password = devPassword;
    if (!email || !password) {
      Alert.alert('Missing credentials', 'Enter email and password.');
      return;
    }
    try {
      setDevLoading(true);
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.session) throw new Error('Sign in failed.');
    } catch (e: any) {
      Alert.alert('Dev login failed', e?.message ?? 'Unknown error');
    } finally {
      setDevLoading(false);
    }
  };

  return (
    <ImageBackground
      source={require('@/assets/login-hero.png')}
      style={styles.container}
      resizeMode="cover"
    >
      <StatusBar style="light" />
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Hero spacer — the crate lives in the background image, we just reserve room for it */}
            <View style={styles.heroSpacer} />

            <View style={styles.titleBlock}>
              <Text style={styles.title}>Stockr</Text>
              <Text style={styles.subtitle}>Emergency supplies tracker</Text>
            </View>

            <View style={styles.footer}>
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                cornerRadius={radius.md}
                style={styles.appleBtn}
                onPress={handleAppleSignIn}
              />
              {loading && <Text style={styles.loading}>Signing in…</Text>}

              {canContinueOffline && (
                <Pressable
                  style={({ pressed }) => [styles.offlineBtn, pressed && { opacity: 0.7 }]}
                  onPress={handleContinueOffline}
                >
                  <Icon sf="wifi.slash" size={16} color={colors.heroText} />
                  <Text style={styles.offlineBtnText}>Continue offline</Text>
                </Pressable>
              )}

              {__DEV__ && (
                <View style={styles.devSection}>
                  <View style={styles.divider}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>DEV ONLY</Text>
                    <View style={styles.dividerLine} />
                  </View>

                  <TextInput
                    value={devEmail}
                    onChangeText={setDevEmail}
                    placeholder="test@stockr.local"
                    placeholderTextColor={colors.heroTextSubtle}
                    style={styles.input}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    textContentType="username"
                  />
                  <TextInput
                    value={devPassword}
                    onChangeText={setDevPassword}
                    placeholder="password"
                    placeholderTextColor={colors.heroTextSubtle}
                    style={styles.input}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="password"
                    returnKeyType="go"
                    onSubmitEditing={handleDevLogin}
                  />
                  <Pressable
                    style={[styles.devBtn, devLoading && { opacity: 0.6 }]}
                    onPress={handleDevLogin}
                    disabled={devLoading}
                  >
                    {devLoading ? (
                      <ActivityIndicator color={colors.heroTextMuted} />
                    ) : (
                      <Text style={styles.devBtnText}>Dev login (skip Apple)</Text>
                    )}
                  </Pressable>
                </View>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.heroBackground,
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
  },
  // Reserves vertical space for the crate in the background image.
  // The image's crate sits roughly in the upper 40% — this spacer pushes
  // everything else below it.
  heroSpacer: {
    height: '45%',
    minHeight: 280,
  },
  titleBlock: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  title: {
    ...typography.largeTitle,
    fontSize: 44,
    lineHeight: 48,
    color: colors.heroText,
    letterSpacing: -0.5,
  },
  subtitle: {
    ...typography.callout,
    color: colors.heroTextMuted,
    marginTop: spacing.xs,
  },
  footer: {
    marginTop: 'auto',
    paddingBottom: spacing.lg,
    paddingTop: spacing.lg,
  },
  appleBtn: {
    width: '100%',
    height: 52,
  },
  offlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    width: '100%',
    height: 48,
    marginTop: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  offlineBtnText: {
    ...typography.body,
    color: colors.heroText,
    fontWeight: '600',
  },
  loading: {
    ...typography.footnote,
    textAlign: 'center',
    marginTop: spacing.md,
    color: colors.heroTextMuted,
  },

  // Dev section
  devSection: {
    marginTop: spacing.xl,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.heroBorder,
  },
  dividerText: {
    ...typography.caption2,
    color: colors.heroTextSubtle,
    letterSpacing: 1.5,
    marginHorizontal: spacing.sm,
  },
  input: {
    ...typography.subhead,
    backgroundColor: colors.heroSurface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.heroText,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.heroBorder,
  },
  devBtn: {
    marginTop: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.heroSurface,
    borderWidth: 1,
    borderColor: colors.heroBorder,
    alignItems: 'center',
  },
  devBtnText: {
    ...typography.footnote,
    color: colors.heroTextMuted,
    fontWeight: '600',
  },
});
