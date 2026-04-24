// ============================================================================
// Kalta – SecureStore helpers
// Device-local secrets backed by iOS Keychain (via expo-secure-store).
// Currently only stores the Anthropic API key used for Claude Vision product
// identification. Each device manages its own key — nothing is synced or
// shared with Supabase.
// ============================================================================
import * as SecureStore from 'expo-secure-store';

const ANTHROPIC_KEY = 'kalta.anthropicKey';

export async function getAnthropicKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(ANTHROPIC_KEY);
  } catch {
    return null;
  }
}

export async function setAnthropicKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(ANTHROPIC_KEY, key);
}

export async function clearAnthropicKey(): Promise<void> {
  await SecureStore.deleteItemAsync(ANTHROPIC_KEY);
}
