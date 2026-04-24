# Kalta — Support

Troubleshooting and common issues. For "how does this feature work?" questions, head over to the [Documentation](/docs).

## App crashes or freezes

### App crashes on launch

Usually caused by corrupted local cache. Try, in order:

1. **Restart your iPhone** and reopen Kalta.
2. If it still crashes, **delete and reinstall** the app. Your data is safe in our backend and restores automatically on sign-in.
3. If the reinstalled app also crashes immediately, **email us** with your iPhone model and iOS version — it's likely a bug we need to patch.

### Specific screen freezes

Force-close the app (swipe up from the bottom, hold, swipe Kalta off screen) and reopen. If the same screen freezes every time, email us the details so we can reproduce.

## Sync and data issues

### Changes I made aren't showing on my other device

1. Check that **both devices have internet** — cloud sync requires it. For offline-to-offline transfer, use [P2P sync](/docs/collaboration#p2p-sync-two-nearby-iphones).
2. **Pull down to refresh** on the warehouses list or inside a warehouse.
3. Force-close Kalta on the other device and reopen — it'll sync on launch.
4. Check the sync indicator in the top bar. If it shows **"Syncing…"** for a very long time, there may be a backend issue. Try again in a few minutes.

### I see "Conflicts" — what do I do?

A conflict means the same item was edited differently on two devices while offline. Kalta merged most changes automatically, but flagged the ambiguous ones for you to resolve.

1. Settings → **Conflicts** → list of unresolved items.
2. For each, pick whether you want the **local** version or the **server** version.
3. After resolving, the item updates across all your devices.

### I signed out and my data disappeared

Only the **local cache** on that device was cleared. Your inventory is safe in our backend. Sign back in with the **same Apple ID** and everything restores.

## Sharing and invitations

### My invite link isn't working for the recipient

Possible causes:

1. **Link expired** (7-day window). Generate a fresh one from the warehouse's Settings → Invite.
2. **Recipient hasn't installed Kalta yet.** The link opens the App Store; they need to install, then tap the link again — or Kalta should process the pending invite automatically on first launch.
3. **Recipient is signed into the wrong Apple ID.** The invitation binds to the Apple ID that's signed in when the link is accepted.

### I removed the wrong person — can I undo?

No, but you can re-invite them with a new link. Their previous access is fully revoked from the moment of removal.

## Scanning issues

### Barcode scanner not recognizing anything

1. **Clean the camera lens** — a smudged lens throws off focus.
2. **Light the product** — harsh shadows or glare on barcodes confuse the reader.
3. **Hold at ~15 cm distance** — too close and the phone can't focus, too far and the bars are too thin.
4. **Flat surfaces work better** than curved ones. For bottles or tubes, angle the phone so the barcode is as flat as possible in view.

### Scanner shows "Unknown product"

This means the barcode is not in Open Food Facts' database (common for private-label store brands). Tap **Manual entry** to fill in the fields. Kalta saves your entry as a custom product — next time you scan that barcode, it loads automatically.

See [Scanning and AI → Custom products](/docs/scanning-and-ai#when-barcode-lookup-fails-custom-products) for details.

### AI "Suggest with AI" button is missing

The AI feature is **off by default**. Enable it in Settings → AI by adding your Anthropic API key. See [Scanning and AI → AI-assisted product recognition](/docs/scanning-and-ai#ai-assisted-product-recognition-claude-vision) for setup.

## Notifications

### I'm not getting expiry reminders

Check in this order:

1. **iOS Settings → Notifications → Kalta** — make sure alerts are allowed.
2. **Focus modes / Do Not Disturb** not blocking Kalta.
3. Kalta **Settings → Notifications** — verify that expiry reminders are toggled on and the windows you expect (30d / 7d / 1d / today) are enabled.
4. **Low Power Mode** can delay notifications.
5. For items added **before** you enabled notifications, open each item and save it again to re-schedule with current settings.

### The badge count is wrong

The badge counts **expired** items (already past expiry date). Not items in the 0–30 day "critical" window.

To clear the badge: open each expired item and either update the expiry date, mark it as consumed/discarded (delete), or the badge updates on next launch after sync.

## Printer issues

### Printer not found

1. **Printer must be on and paired in iOS Bluetooth** (Settings → Bluetooth) before Kalta can see it.
2. Some older Brother printers need a button press to accept the pairing.
3. In Kalta → box → Print QR → **Select printer** → tap refresh.

### Prints blank or misaligned labels

- **Label size in Kalta must match** the roll loaded in the printer.
- Reload the paper roll if it's misaligned.

See [Printing QR labels](/docs/printing) for full printer setup.

## P2P sync issues

See [Sharing & P2P sync → Troubleshooting P2P](/docs/collaboration#troubleshooting-p2p). Common fixes:

- Bluetooth on, not in Low Power Mode.
- Both devices on the P2P Sync screen at the same time.
- Force-close and reopen the app on both devices.

## Refunds and purchases

### How do I get a refund?

Refunds are handled by Apple, not by us. Visit https://reportaproblem.apple.com, find the Kalta purchase, and request a refund. Apple decides based on their own policy.

### Bought Kalta — can my family member use it too?

Yes, if you're set up for **Apple Family Sharing** and Kalta's Family Sharing flag is enabled. Your family members can install Kalta without paying again.

## Privacy and account

### Where is my data stored?

On your iPhone (local SQLite + iOS Keychain for secrets) and in our Supabase backend hosted in **Ireland, EEA**. See the [Privacy Policy](/privacy) for the full breakdown.

### Export my data

Email us at **ondrej.michalcik@gmail.com**. We'll provide a JSON export.

### Delete my account

Email us at **ondrej.michalcik@gmail.com** from the email associated with your Apple ID. We delete your account and the warehouses you own within 30 days.

## Still stuck?

Email **ondrej.michalcik@gmail.com** with:

- A short description of the problem.
- Your iPhone model and iOS version (Settings → General → About).
- Your Kalta app version (Settings → bottom of the screen).
- Screenshot if relevant.

We're a one-person operation, so replies may take 3–5 business days.
