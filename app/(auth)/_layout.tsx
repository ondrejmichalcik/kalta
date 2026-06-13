// ============================================================================
// Kalta – (auth) group layout
// No header bar, no back gesture — auth screens are "terminal" before login
// ============================================================================
import { Stack } from 'expo-router';

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
