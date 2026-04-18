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
import type { Item } from '@/src/types/database';
import { daysUntil } from '@/src/types/database';

const SETTINGS_KEY = 'stockr:notificationsEnabled';
const WINDOWS_KEY = 'stockr:notificationWindows';
const MAX_SCHEDULED = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

// Available reminder windows (days before expiry).
export const ALL_WINDOWS = [30, 7, 1, 0] as const;
export type ReminderWindow = (typeof ALL_WINDOWS)[number];

// Default: all windows enabled.
const DEFAULT_WINDOWS: ReminderWindow[] = [30, 7, 1, 0];

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
 * Get which reminder windows are enabled.
 */
export async function getReminderWindows(): Promise<ReminderWindow[]> {
  const raw = await AsyncStorage.getItem(WINDOWS_KEY);
  if (!raw) return DEFAULT_WINDOWS;
  try {
    return JSON.parse(raw) as ReminderWindow[];
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

  // Collect all notification candidates.
  const candidates: { item: ItemWithBox; daysBeforeExpiry: number; triggerDate: Date }[] = [];

  const now = Date.now();
  let expiringCount = 0; // for app badge

  for (const item of items) {
    if (!item.expiry_date) continue;

    const [y, m, d] = item.expiry_date.split('-').map(Number);
    const expiryMs = new Date(y, m - 1, d).getTime();

    // Count items expiring within 30 days for badge
    const daysLeft = Math.ceil((expiryMs - now) / DAY_MS);
    if (daysLeft <= 30) expiringCount++;

    for (const daysBefore of activeWindows) {
      const triggerMs = expiryMs - daysBefore * DAY_MS;
      // Only schedule future triggers (at least 1 minute from now).
      if (triggerMs > now + 60_000) {
        candidates.push({
          item,
          daysBeforeExpiry: daysBefore,
          triggerDate: new Date(triggerMs),
        });
      }
    }

    // Also schedule for already-expired items: one "expired" notification
    // for tomorrow morning (8:00) if the item is expired and we haven't
    // alerted yet. This catches items that expired while app was closed.
    const days = daysUntil(item.expiry_date);
    if (days < 0 && days >= -3) {
      // Expired in last 3 days — remind once
      const tomorrow8am = new Date();
      tomorrow8am.setDate(tomorrow8am.getDate() + 1);
      tomorrow8am.setHours(8, 0, 0, 0);
      candidates.push({
        item,
        daysBeforeExpiry: -1, // sentinel for "already expired"
        triggerDate: tomorrow8am,
      });
    }
  }

  // Sort by trigger date (earliest first) and cap at MAX_SCHEDULED.
  candidates.sort((a, b) => a.triggerDate.getTime() - b.triggerDate.getTime());
  const toSchedule = candidates.slice(0, MAX_SCHEDULED);

  // Schedule each notification.
  for (const { item, daysBeforeExpiry, triggerDate } of toSchedule) {
    const boxHint = item.box_name ? ` in ${item.box_name}` : '';
    let title: string;
    let body: string;

    if (daysBeforeExpiry === -1) {
      title = 'Item expired';
      body = `${item.name}${boxHint} has expired. Check and replace.`;
    } else if (daysBeforeExpiry === 0) {
      title = 'Expiring today';
      body = `${item.name}${boxHint} expires today.`;
    } else if (daysBeforeExpiry === 1) {
      title = 'Expiring tomorrow';
      body = `${item.name}${boxHint} expires tomorrow.`;
    } else if (daysBeforeExpiry === 7) {
      title = 'Expiring in 1 week';
      body = `${item.name}${boxHint} expires in 7 days.`;
    } else {
      title = 'Expiring soon';
      body = `${item.name}${boxHint} expires in ${daysBeforeExpiry} days.`;
    }

    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: { itemId: item.id, boxId: item.box_id, warehouseId: item.warehouse_id },
        sound: true,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerDate },
    });
  }

  // Set app badge to count of items expiring within 30 days.
  // 0 clears the badge.
  await Notifications.setBadgeCountAsync(expiringCount);
}
