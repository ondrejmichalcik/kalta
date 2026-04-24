// ============================================================================
// Kalta – Catch-all for unmatched routes
// Handles deep links like kalta://invite/TOKEN that don't map to a file
// route. The actual invite processing happens in _layout.tsx via
// Linking.getInitialURL / addEventListener. This screen just redirects home
// so the user doesn't see a blank "unmatched route" page.
// ============================================================================
import { useEffect } from 'react';
import { useRouter } from 'expo-router';

export default function NotFoundScreen() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to home — the deep link handler in _layout.tsx already
    // processed any invite token by the time this screen mounts.
    router.replace('/' as any);
  }, [router]);

  return null;
}
