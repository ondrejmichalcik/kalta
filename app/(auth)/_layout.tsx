// ============================================================================
// Kalta – (auth) group layout
// Bez header baru, bez back gesta — auth obrazovky jsou "terminální" před loginem
// ============================================================================
import { Stack } from 'expo-router';

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
