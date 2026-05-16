# Apple Review Notes

Paste this into **App Store Connect → App Information → App Review Information → Notes** when submitting for review.

---

## Test account

**Sign in with Apple** is the only authentication method. Please use **any Apple ID** of your choice — the app works for any account, no pre-seeded test account is needed.

We do not require email or name from your Apple ID; you can use a private relay email and any display name.

Once signed in, you can:

1. Tap **+** on the warehouses screen to create a sample warehouse.
2. Tap **+** inside the warehouse to create a sample box (a QR label is generated automatically).
3. Open the box → **Add items** → use **Manual entry** to add a few sample items with expiration dates.

This produces a fully working app state in under two minutes for the review.

The demo data shown in the App Store screenshots was generated this way for illustration purposes.

---

## Feature walkthrough

A full review can be done in ~3 minutes:

1. **Launch app** → Sign in with Apple (demo account above).
2. **Dashboard** — see warehouses sorted by urgency.
3. **Open a warehouse** → see boxes sorted by earliest expiry.
4. **Open a box** → see items color-coded by expiry.
5. **Scan a barcode** — use the Scan tab or the QR button on a box. The scanner recognizes any EAN-13 code (e.g., from a can in your kitchen).
6. **Add an item manually** — box detail → Add items → Manual entry.
7. **Share a warehouse** — warehouse Settings → Invite → generates a link.
8. **P2P sync** — Settings → P2P Sync → Start searching. Requires two devices to test.
9. **Print QR label** — box detail → Print QR → requires a Brother Bluetooth printer to test.

---

## Permissions and why

- **Camera** — Required to scan box QR codes and product barcodes, and to take item photos.
- **Photo Library** — Required to attach photos from library or save item photos.
- **Bluetooth** — Required to print QR labels on Brother printers AND for P2P sync with another iPhone.
- **Local Network** — Required to discover Brother printer on WiFi AND for P2P sync Bonjour discovery.
- **Notifications** — Optional. Used only for local expiry reminders, scheduled on-device. No remote push.

All permissions are lazy (prompted at point of use), not requested on launch.

---

## Third-party services

- **Apple** (Sign in with Apple)
- **Supabase** (backend database + image storage, hosted in Ireland, EEA)
- **Open Food Facts** (public barcode lookup, France — no user data sent, only barcode number)
- **Anthropic** (optional AI product recognition, USA — only if user enters their own API key; feature is disabled by default)

No third-party analytics, ads, or tracking SDKs.

---

## AI feature (BYOK — bring your own key)

The AI-assisted product recognition feature is **disabled by default**. It activates only when the user adds their own Anthropic API key in Settings → AI. This is explained in-app and on the Privacy Policy page.

To test the AI feature, the reviewer can either:

1. Skip it (feature is fully optional and the app works without it), or
2. Obtain a free-tier Anthropic API key from https://console.anthropic.com and paste it in Settings → AI. Typical cost per scan is fractional cents.

---

## Subscription notes

- **App price:** Free download.
- **In-app purchase:** Auto-renewing yearly subscription **Kalta Cloud** at **Tier 15 (~$14.99 USD / year)** with Apple Small Business Program enabled.
- **Mandatory paywall on first launch** for users with no prior purchase history. Reviewers signing in with a sandbox Apple ID will see the paywall after Apple Sign In — please tap **Subscribe** to proceed. The sandbox environment makes this free.
- **Restore Purchases** is available on the paywall and in Profile → Subscription for users reinstalling the app.
- **Family Sharing** is enabled — one subscription covers up to 6 family members.
- **After cancellation / lapse**, the app continues to work locally; only cloud sync, image upload, and AI features are gated. The user can keep adding and editing inventory on-device indefinitely.
- **Cloud data retention after lapse:** 30 days, then server-side cleanup. Disclosed in the Terms of Service and Privacy Policy.
- **Refunds** are handled by Apple via https://reportaproblem.apple.com.

---

## Known reviewer-facing quirks

- On **first launch**, the app schedules a background sync of cached data; it may display a brief "Syncing…" banner. This is expected.
- **P2P Sync** requires two iPhones. If the reviewer has only one device available, it is safe to skip testing the P2P screen — the screen opens, starts the advertising session, but cannot establish a pair without a second device.
- **Printer** testing requires a physical Brother Bluetooth label printer. Reviewer can open the print screen to verify the UI renders; the "Select printer" flow requires a paired printer to complete.

---

## Compliance / Privacy links

- **Privacy Policy:** https://kalta.app/privacy
- **Terms of Service:** https://kalta.app/terms
- **Support:** https://kalta.app/support

---

## Contact

Questions during review:

**Ondřej Michalčík**
Email: ondrej.michalcik@gmail.com

Typical response within 24 hours during business days (CET time zone).
