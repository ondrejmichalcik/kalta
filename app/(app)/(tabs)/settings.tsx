// ============================================================================
// Stockr – Settings tab
// Placeholder for Sprint 2.6. Hosts sign out today, will grow to include
// invitations, notifications, theme, about, etc. across later sprints.
// ============================================================================
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signOut } from '@/src/lib/supabase';
import { colors, radius, spacing, typography } from '@/src/theme';

export default function SettingsScreen() {
  const handleSignOut = () => {
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          signOut().catch(() => {});
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>
      <View style={styles.body}>
        <Pressable
          style={({ pressed }) => [styles.signOutBtn, pressed && { opacity: 0.7 }]}
          onPress={handleSignOut}
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: {
    ...typography.largeTitle,
    fontSize: 32,
    lineHeight: 38,
    color: colors.text,
    letterSpacing: -0.5,
  },
  body: {
    padding: spacing.lg,
  },
  signOutBtn: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  signOutText: {
    ...typography.body,
    color: colors.danger,
    fontWeight: '600',
  },
});
