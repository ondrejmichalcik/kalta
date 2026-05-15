// ============================================================================
// Kalta – Paywall
// Mandatory on first launch (no purchase history); dismissible when reached
// from Settings / Renew banner via `?canDismiss=1`.
// ============================================================================
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ImageBackground,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Icon, type SFSymbolName } from '@/src/components/Icon';
import {
  SUBSCRIPTION_ENFORCEMENT_ENABLED,
  fetchSubscriptionProduct,
  purchaseSubscription,
  restoreSubscription,
  useSubscription,
} from '@/src/lib/subscription';
import { colors, radius, spacing, typography } from '@/src/theme';

const TERMS_URL = 'https://kalta.app/terms';
const PRIVACY_URL = 'https://kalta.app/privacy';

const FEATURES: Array<{ sf: SFSymbolName; title: string; body: string }> = [
  {
    sf: 'icloud.fill',
    title: 'Cloud sync across devices',
    body: 'Your warehouses stay in sync between iPhone and iPad.',
  },
  {
    sf: 'person.2.fill',
    title: 'Share with your household',
    body: 'Co-manage warehouses with family — edits show up live.',
  },
  {
    sf: 'sparkles',
    title: 'AI item recognition',
    body: 'Snap a photo of any product and Kalta fills in the name.',
  },
  {
    sf: 'externaldrive.badge.checkmark',
    title: 'Automatic cloud backup',
    body: 'Lose your phone? Restore your full inventory in one tap.',
  },
];

export default function PaywallScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ canDismiss?: string }>();
  const canDismiss = params.canDismiss === '1';

  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [displayPrice, setDisplayPrice] = useState<string | null>(null);
  const { status } = useSubscription();

  // Watch for subscription state to flip out of `never` — that means the
  // purchase completed (or a Restore surfaced historical entitlements).
  // Dismiss the paywall back to the app. With enforcement off the status
  // is always `active`, so we'd bounce off the screen immediately —
  // skip the redirect in that case to keep the screen previewable.
  useEffect(() => {
    if (!SUBSCRIPTION_ENFORCEMENT_ENABLED) return;
    if (status === 'active' || status === 'lapsed') {
      router.replace('/' as any);
    }
  }, [status, router]);

  // Try to pull the localized price from StoreKit. Falls back to the
  // hardcoded "$14.99" when enforcement is off or the store can't be
  // reached — the visual layout shouldn't ever wait for it.
  useEffect(() => {
    if (!SUBSCRIPTION_ENFORCEMENT_ENABLED) return;
    fetchSubscriptionProduct()
      .then((p) => {
        const raw = (p as any)?.displayPrice ?? (p as any)?.localizedPrice;
        if (raw) setDisplayPrice(raw);
      })
      .catch(() => {});
  }, []);

  const priceText = displayPrice ?? '$14.99';

  const handleSubscribe = async () => {
    if (purchasing) return;
    if (!SUBSCRIPTION_ENFORCEMENT_ENABLED) {
      Alert.alert(
        'Coming soon',
        'Subscriptions are not yet enabled in this build. The flow will activate once Apple Paid Apps Agreement is active.',
      );
      return;
    }
    try {
      setPurchasing(true);
      await purchaseSubscription();
      // Result is delivered via the `purchaseUpdatedListener` in
      // `useSubscription` — the hook will refresh state and the navigator
      // can decide where to send the user next. We just dismiss here if
      // we were modal.
      if (canDismiss) router.back();
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (/cancel/i.test(msg)) return;
      Alert.alert('Purchase failed', msg);
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    if (restoring) return;
    try {
      setRestoring(true);
      await restoreSubscription();
      Alert.alert(
        'Restore complete',
        'If you have an active or past subscription, it has been restored.',
      );
    } catch (e: any) {
      Alert.alert('Restore failed', e?.message ?? 'Unknown error');
    } finally {
      setRestoring(false);
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
        {canDismiss ? (
          <View style={styles.closeBar}>
            <Pressable
              onPress={() => router.back()}
              hitSlop={12}
              style={({ pressed }) => [
                styles.closeBtn,
                pressed && { opacity: 0.6 },
              ]}
            >
              <Icon sf="xmark" size={16} color={colors.heroText} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.closeBarSpacer} />
        )}

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heroSpacer} />

          <View style={styles.titleBlock}>
            <Text style={styles.title}>Kalta Cloud</Text>
            <Text style={styles.subtitle}>
              Unlock sync, sharing, and AI features.
            </Text>
          </View>

          <View style={styles.features}>
            {FEATURES.map((f) => (
              <View key={f.title} style={styles.feature}>
                <View style={styles.featureIcon}>
                  <Icon sf={f.sf} size={18} color={colors.heroText} />
                </View>
                <View style={styles.featureText}>
                  <Text style={styles.featureTitle}>{f.title}</Text>
                  <Text style={styles.featureBody}>{f.body}</Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            disabled={purchasing}
            onPress={handleSubscribe}
            style={({ pressed }) => [
              styles.subscribeBtn,
              (pressed || purchasing) && { opacity: 0.85 },
            ]}
          >
            {purchasing ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.subscribeText}>
                Subscribe — {priceText} / year
              </Text>
            )}
          </Pressable>

          <Text style={styles.disclosure}>
            Auto-renewable subscription. Cancel anytime in App Store settings.
            Renews at {priceText} / year unless canceled at least 24 hours
            before the renewal date.
          </Text>

          <View style={styles.linksRow}>
            <Pressable
              onPress={handleRestore}
              disabled={restoring}
              hitSlop={8}
            >
              <Text style={styles.linkText}>
                {restoring ? 'Restoring…' : 'Restore'}
              </Text>
            </Pressable>
            <Text style={styles.linkDot}>·</Text>
            <Pressable
              onPress={() => Linking.openURL(TERMS_URL)}
              hitSlop={8}
            >
              <Text style={styles.linkText}>Terms</Text>
            </Pressable>
            <Text style={styles.linkDot}>·</Text>
            <Pressable
              onPress={() => Linking.openURL(PRIVACY_URL)}
              hitSlop={8}
            >
              <Text style={styles.linkText}>Privacy</Text>
            </Pressable>
          </View>
        </View>
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
  closeBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  closeBarSpacer: {
    height: spacing.lg,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
  },
  // Pushes content below the crate in the hero image.
  heroSpacer: {
    height: 180,
  },
  titleBlock: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  title: {
    ...typography.largeTitle,
    fontSize: 36,
    lineHeight: 40,
    color: colors.heroText,
    letterSpacing: -0.5,
  },
  subtitle: {
    ...typography.body,
    color: colors.heroTextMuted,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  features: {
    gap: spacing.lg,
    paddingBottom: spacing.xl,
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  featureIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  featureText: {
    flex: 1,
  },
  featureTitle: {
    ...typography.headline,
    color: colors.heroText,
    marginBottom: 2,
  },
  featureBody: {
    ...typography.subhead,
    color: colors.heroTextMuted,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    paddingTop: spacing.md,
  },
  subscribeBtn: {
    height: 54,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subscribeText: {
    ...typography.headline,
    color: colors.textOnPrimary,
    fontWeight: '700',
  },
  disclosure: {
    ...typography.caption,
    color: colors.heroTextSubtle,
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 16,
  },
  linksRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  linkText: {
    ...typography.footnote,
    color: colors.heroText,
    textDecorationLine: 'underline',
  },
  linkDot: {
    ...typography.footnote,
    color: colors.heroTextSubtle,
  },
});