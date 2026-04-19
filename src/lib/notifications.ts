// ============================================================================
// Stockr – Local expiry notifications
// Schedules iOS local notifications for items approaching expiry. Runs on
// every app foreground — cancels all previously scheduled notifications
// and re-schedules from scratch based on current DB state. This idempotent
// approach avoids stale/duplicate notifications after item edits, moves,
// or deletions.
//
// No server push — everything is local. Works fully offline once
// scheduled.
//
// iOS limits ~64 pending local notifications. We prioritize by nearest
// expiry and cap at 60 to leave headroom.
// ============================================================================
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SETTINGS_KEY = 'stockr:notificationsEnabled';
const WINDOWS_KEY = 'stockr:notificationWindows';
const MAX_SCHEDULED = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

// Available reminder windows (days before expiry).
// 60 = heads-up, 30 = getting close, 1 = act now.
export const ALL_WINDOWS = [60, 30, 1] as const;
export type ReminderWindow = (typeof ALL_WINDOWS)[number];

// Default: all windows enabled.
const DEFAULT_WINDOWS: ReminderWindow[] = [60, 30, 1];

/**
 * Check if the user has enabled expiry notifications.
 * Default: true (opt-out, not opt-in).
 */
export async function isNotificationsEnabled(): Promise<boolean> {
  const val = await AsyncStorage.getItem(SETTINGS_KEY);
  return val !== 'false'; // default true
}

export async function setNotificationsEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, String(enabled));
  if (!enabled) {
    await Notifications.cancelAllScheduledNotificationsAsync();
  }
}

/**
 * Get which reminder windows are enabled. Filters out values that aren't
 * in the current ALL_WINDOWS set — e.g. a user who previously had {30, 7}
 * saved won't schedule 7-day reminders any more.
 */
export async function getReminderWindows(): Promise<ReminderWindow[]> {
  const raw = await AsyncStorage.getItem(WINDOWS_KEY);
  if (!raw) return DEFAULT_WINDOWS;
  try {
    const saved = JSON.parse(raw) as number[];
    const valid = saved.filter(
      (w): w is ReminderWindow => (ALL_WINDOWS as readonly number[]).includes(w),
    );
    return valid.length > 0 ? valid : DEFAULT_WINDOWS;
  } catch {
    return DEFAULT_WINDOWS;
  }
}

/**
 * Set which reminder windows are enabled. Pass an array of days-before-expiry.
 */
export async function setReminderWindows(windows: ReminderWindow[]): Promise<void> {
  await AsyncStorage.setItem(WINDOWS_KEY, JSON.stringify(windows));
}

/**
 * Request notification permission. Returns true if granted.
 * On iOS 12+ this is required before scheduling.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Configure how notifications appear when the app is in the foreground.
 */
export function setupForegroundHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

interface ItemWithBox {
  id: string;
  name: string;
  expiry_date: string | null;
  box_id: string;
  box_name?: string;
  warehouse_id?: string;
}

/**
 * Cancel all existing scheduled notifications, then re-schedule
 * based on the provided items. Called on every app foreground.
 *
 * @param items All items across all warehouses the user is a member of.
 *              Must include `expiry_date` and ideally `box_name` for
 *              richer notification text.
 */
export async function rescheduleExpiryNotifications(
  items: ItemWithBox[],
): Promise<void> {
  const enabled = await isNotificationsEnabled();
  if (!enabled) return;

  const granted = await requestNotificationPermission();
  if (!granted) return;

  // Cancel everything — idempotent reschedule from scratch.
  await Notifications.cancelAllScheduledNotificationsAsync();

  // Load user-configured reminder windows
  const activeWindows = await getReminderWindows();

  const now = Date.now();
  let expiringCount = 0; // for app badge

  // --- Group items by (window, crossing day).
  // For each window W, an item's "crossing moment" is expiry - W days. On
  // that day the item newly enters the ≤W bucket. We fire ONE notification
  // per window per day containing the list of items crossing that day,
  // so the user gets at most three grouped alerts (60/30/1) for each
  // distinct crossing date rather than one-per-item per-window.
  interface GroupKey { window: number; dateKey: string }
  interface Group { window: number; triggerDate: Date; items: ItemWithBox[] }
  const groups = new Map<string, Group>();

  for (const item of items) {
    if (!item.expiry_date) continue;

    const [y, m, d] = item.expiry_date.split('-').map(Number);
    const expiryMs = new Date(y, m - 1, d).getTime();

    // Count items within the 60-day urgency bucket for the app badge.
    // The Warehouses-list attention banner tiers the 60/30/1d counts so
    // the user sees what the badge is about with the right urgency color.
    const daysLeft = Math.ceil((expiryMs - now) / DAY_MS);
    if (daysLeft <= 60) expiringCount++;

    for (const windowDays of activeWindows) {
      const crossMs = expiryMs - windowDays * DAY_MS;
      // Fire at 08:00 local on the crossing day.
      const cross = new Date(crossMs);
      cross.setHours(8, 0, 0, 0);
      if (cross.getTime() < now + 60_000) continue; // in the past / too close

      const dateKey = `${cross.getFullYear()}-${cross.getMonth()}-${cross.getDate()}`;
      const gKey = `${windowDays}|${dateKey}`;
      const existing = groups.get(gKey);
      if (existing) {
        existing.items.push(item);
      } else {
        groups.set(gKey, {
          window: windowDays,
          triggerDate: cross,
          items: [item],
        });
      }
    }
  }

  // Sort groups by trigger date (earliest first) and cap at MAX_SCHEDULED.
  const ordered = Array.from(groups.values()).sort(
    (a, b) => a.triggerDate.getTime() - b.triggerDate.getTime(),
  );
  const toSchedule = ordered.slice(0, MAX_SCHEDULED);

  for (const g of toSchedule) {
    const count = g.items.length;
    const s = count === 1 ? '' : 's';
    let title: string;
    if (g.window === 1) {
      title = `${count} item${s} expiring within a day`;
    } else {
      title = `${count} item${s} with ≤${g.window} days`;
    }
    // Body: list up to 5 item names, then "+N more" if overflow.
    const names = g.items.map((i) => i.name);
    const shown = names.slice(0, 5).join(', ');
    const overflow = names.length > 5 ? ` +${names.length - 5} more` : '';
    const body = shown + overflow;

    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        // Tap navigates to the alerts screen pre-filtered for this window.
        data: { window: g.window },
        sound: true,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: g.triggerDate },
    });
  }

  // Set app badge to count of items in the 60-day urgency bucket.
  // 0 clears the badge.
  await Notifications.setBadgeCountAsync(expiringCount);
}

/**
 * Set the app icon badge directly. Used by screens that compute the count
 * themselves (Warehouses list refresh) or want to clear the badge on view
 * (alerts screen). The full reschedule above also sets the badge — use
 * this for lighter-weight updates that don't need to touch the schedule.
 */
export async function setAppBadge(count: number): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, count));
  } catch {
    // Permission may not be granted yet; ignore.
  }
}
