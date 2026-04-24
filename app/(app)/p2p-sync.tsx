// ============================================================================
// Kalta – P2P Sync screen
// Placeholder. Native MultipeerConnectivity module crashes on startSession()
// call in TestFlight builds (NSException from iOS's MC framework that isn't
// Swift-catchable). Bisect narrowed down both:
//   - A Hermes HBC bug: static `module.member` references in a useCallback
//     body crash the screen on mount → workaround is dynamic import.
//   - The native startSession call itself still aborts after the dynamic
//     import resolves. That is a Swift/MCP layer problem, not a JS one.
// Re-enable once we can attach Xcode to the device for a symbolicated
// native crash trace. All supporting plumbing (autolinking config,
// Info.plist Bonjour services, Swift module source) is intact in the
// repo so it's just about flipping this screen back on once the native
// call is fixed.
// ============================================================================
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors, radius, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';

export default function P2PSyncScreen() {
  const router = useRouter();
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
        <Text style={styles.topBarTitle}>P2P Sync</Text>
        <View style={styles.topBarBtn} />
      </View>

      <View style={styles.content}>
        <Icon sf="antenna.radiowaves.left.and.right" size={64} color={colors.textSubtle} />
        <Text style={styles.headline}>Temporarily disabled</Text>
        <Text style={styles.description}>
          Peer-to-peer sync is being fixed and will return in a future build.
          In the meantime everything syncs through the cloud whenever the
          device is online.
        </Text>
      </View>
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
  topBarBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  topBarTitle: { ...typography.headline, color: colors.text, flex: 1, textAlign: 'center' },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
    paddingBottom: 80,
  },
  headline: { ...typography.title2, color: colors.text, textAlign: 'center' },
  description: {
    ...typography.subhead,
    color: colors.textMuted,
    textAlign: 'center',
    maxWidth: 300,
    lineHeight: 22,
  },
});
