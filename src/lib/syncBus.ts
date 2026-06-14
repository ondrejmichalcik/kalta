// ============================================================================
// Kalta – Sync bus
// Decouples "remote data changed" from the screens. Two pieces:
//   • scheduleRemotePull(userId) — debounced trigger that pulls remote changes
//     into local SQLite. Called by realtime subscriptions and the foreground/
//     interval backstop. Coalesces a burst (e.g. a partner adding 20 items)
//     into a single sync cycle.
//   • onDataChanged(cb) / emitDataChanged() — a tiny pub/sub the sync engine
//     fires after a pull that actually landed new rows, so any mounted screen
//     can re-read local SQLite and re-render.
//
// Without this, realtime events made screens re-query SQLite *before* the
// remote change was pulled in, so a partner's additions only appeared after a
// full restart (which runs initialFullSync).
//
// Kept in its own module to avoid an import cycle: sync.ts imports
// emitDataChanged from here, and this file lazy-requires sync.ts only when a
// pull actually runs.
// ============================================================================

type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribe to "local data changed after a remote pull". Returns cleanup. */
export function onDataChanged(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Fired by the sync engine after a pull that brought in new/changed rows. */
export function emitDataChanged(): void {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* a bad listener must not break the others */
    }
  }
}

let pullTimer: ReturnType<typeof setTimeout> | null = null;
let pendingUserId: string | null = null;

/**
 * Debounced remote pull. Multiple calls within the window collapse into one
 * sync cycle (~400 ms after the last call). Errors are swallowed — the next
 * trigger (realtime event, foreground, interval) will retry.
 */
export function scheduleRemotePull(userId: string): void {
  pendingUserId = userId;
  if (pullTimer) clearTimeout(pullTimer);
  pullTimer = setTimeout(() => {
    pullTimer = null;
    const uid = pendingUserId;
    pendingUserId = null;
    if (!uid) return;
    // Lazy require to avoid a static import cycle (sync.ts → syncBus.ts).
    const { runSyncCycle } = require('./sync') as typeof import('./sync');
    runSyncCycle(uid).catch(() => {});
  }, 400);
}
