// ============================================================================
// Stockr – Login (Apple Sign In + dev email fallback)
// ============================================================================
import { useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ensureWarehouse, signInWithApple, supabase } from '@/src/lib/supabase';
import { colors, radius, spacing, typography } from '@/src/theme';

export default function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [devEmail, setDevEmail] = useState('');
  const [devPassword, setDevPassword] = useState('');
  const [devLoading, setDevLoading] = useState(false);

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

      // Ensure a warehouse exists for this user
      await ensureWarehouse(data.session.user.id);
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
      await ensureWarehouse(data.session.user.id);
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
