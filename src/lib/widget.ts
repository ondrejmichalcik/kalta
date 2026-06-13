// ============================================================================
// Kalta – Home-screen widget data bridge (Sprint 9)
// Writes a tiny readiness summary into the shared App Group UserDefaults that
// the WidgetKit widget (targets/readiness-widget) reads. Uses
// @bacons/apple-targets' ExtensionStorage — an optional native module present
// only in dev/EAS builds, so every access is guarded (no-op in Expo Go / on
// Android / when the module or App Group isn't available).
// ============================================================================
import { Platform } from 'react-native';

const APP_GROUP = 'group.com.ondrejmichalcik.kalta';

export interface ReadinessWidgetSummary {
  days: number;
  tone: 'green' | 'amber' | 'red' | 'none';
  expiringCount: number;
  warehouseName: string;
}

function appleTargets(): any | null {
  if (Platform.OS !== 'ios') return null;
  try {
    // @ts-ignore — optional native dep; resolved only in dev/EAS builds.
    return require('@bacons/apple-targets');
  } catch {
    return null;
  }
}

/**
 * Push the latest readiness summary to the widget. Best-effort: silently does
 * nothing when the native module / App Group isn't present.
 */
export function updateReadinessWidget(summary: ReadinessWidgetSummary): void {
  const mod = appleTargets();
  const ExtensionStorage = mod?.ExtensionStorage;
  if (!ExtensionStorage) return;
  try {
    const store = new ExtensionStorage(APP_GROUP);
    store.set('readinessDays', Math.max(0, Math.round(summary.days)));
    store.set('readinessTone', summary.tone);
    store.set('expiringCount', summary.expiringCount);
    store.set('warehouseName', summary.warehouseName);
    ExtensionStorage.reloadWidget?.();
  } catch {
    /* widget update is best-effort */
  }
}
