// ============================================================================
// Kalta – Tiny auth bridge
// Expo Router screens can't directly mutate the root layout's React state,
// so "Continue offline" would write to AsyncStorage and navigate without
// the root's `cachedUser` state updating — the auth guard then bounces the
// user back to /login. This module is a pub-sub the login screen emits to
// and the root layout listens on.
// ============================================================================

type Listener = (userId: string | null) => void;

const listeners = new Set<Listener>();

export function emitCachedUserChanged(userId: string | null): void {
  for (const fn of listeners) fn(userId);
}

export function onCachedUserChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
