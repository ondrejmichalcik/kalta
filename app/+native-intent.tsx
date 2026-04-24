// ============================================================================
// Kalta – Deep link intent rewriting
// Intercepts incoming URLs BEFORE Expo Router tries to match them against
// file-based routes. Rewrites kalta://invite/TOKEN to the root route
// so the Linking handler in _layout.tsx can process the invite without
// the router showing "Unmatched Route".
// ============================================================================
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  // Handle all shapes Expo Router may pass us:
  //   kalta://invite/TOKEN  → path "invite/TOKEN" or "/invite/TOKEN"
  //   kalta:///invite/TOKEN → path "/invite/TOKEN"
  // The Linking handler in _layout.tsx does the actual token processing,
  // we just rewrite here so the router doesn't show "Unmatched Route".
  if (path.includes('invite/')) {
    return '/';
  }
  return path;
}
