# Expiry & reminders

Tracking expiration dates is what makes Kalta different from a generic inventory app. This page covers how expiry dates flow through the app: display, sorting, reminders, notifications.

## Adding an expiry date to an item

When adding or editing an item, tap the **Expiration date** field. A date picker opens. Pick the date from the product packaging.

<div class="screenshot">[Screenshot: Item edit sheet with date picker expanded]</div>

Items without an expiry date are allowed — use them for things that don't expire (tools, cookware, fabric, etc.).

## The four-level color coding

Every item with an expiry date falls into one of four states, each with its own color:

| State | When | Color |
|---|---|---|
| **Expired** | Date already past | Red |
| **Critical** | Within 30 days | Orange |
| **Soon** | Within 90 days | Yellow |
| **OK** | More than 90 days away | Green |
| **None** | No expiry date set | Grey |

You'll see this coding everywhere an item or box appears: in the warehouse dashboard, inside boxes, in the cross-box **Items** tab.

## Sorting by urgency

**Items inside a box** are sorted by expiry, soonest first. The critical things are always at the top.

**Boxes in a warehouse** are sorted by the earliest expiry of any item inside. If a box has one can expiring next week and everything else in 5 years, that box still floats to the top.

**Items across boxes** (the **Items** tab at the warehouse level) combine both: items are sorted by expiry urgency, with **opened items appearing first** (since they typically degrade faster once opened).

This is the core "what needs my attention now?" view. Open a warehouse and the top of the list is always the most time-sensitive thing.

## Reminders (local notifications)

Kalta can schedule local iOS notifications for items as they approach expiry. Everything is scheduled on-device — there's no push server involved, so reminders work fully offline.

### Default reminder windows

When you enable notifications, Kalta schedules:

- **30 days before** expiry
- **7 days before** expiry
- **1 day before** expiry
- **On the day** of expiry

You can disable any of these windows individually in Settings → Notifications.

### Enabling notifications

1. Open Kalta → **Settings** → **Notifications**.
2. Toggle **Expiry reminders** on.
3. iOS will ask for notification permission. Tap **Allow**.
4. Customize which windows you want (30d / 7d / 1d / today).

<div class="screenshot">[Screenshot: Settings → Notifications screen with toggles]</div>

The first time you enable notifications, Kalta schedules reminders for all existing items. Newly added items are scheduled automatically as you save them.

### Notification tap behavior

Tap a notification → the app opens directly to the **box containing the expiring item**. No hunting through warehouses.

## Badge count

When **notifications** are enabled, Kalta's app icon shows a **red badge with the count of expired items** across all your warehouses. Items in the "critical" state (0–30 days) are *not* counted by default — only items that are already past their expiry date.

To clear the badge, open each item and either consume / discard it (delete from Kalta) or update the expiry date.

## Why notifications are local-only

Kalta schedules notifications on your iPhone using iOS's local notification API — not a push server. This has several implications:

- **Works offline** — no network needed to deliver reminders.
- **Private** — we don't have a list of what you're tracking or when.
- **Device-specific** — if you have the app on two devices (yours and a family member's), each device schedules its own reminders based on its local data.
- **Depends on iOS state** — notifications respect Focus modes, Do Not Disturb, and Low Power Mode restrictions.

## Troubleshooting reminders

If notifications aren't showing up:

1. **iOS Settings → Notifications → Kalta** — make sure alerts are allowed.
2. Check that you're not in a **Focus mode** that suppresses Kalta.
3. In Kalta → Settings → Notifications, verify the windows you expect are enabled.
4. For items added before you changed your reminder windows, the old schedule may still apply. Reopen the item and save it again to re-schedule with current settings.

## What's next

- If you want a family member to help you keep track, read [Sharing & P2P sync](/docs/collaboration).
- For printing the QR labels you've generated, see [Printing QR labels](/docs/printing).
