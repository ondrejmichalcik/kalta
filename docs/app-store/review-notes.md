# Apple Review Notes

The rest of this file is internal reference for *us*. The ASC "App Review Information → Notes" field has a **4000 character** limit. Copy-paste the trimmed block below into that field; everything else here is context for our own records.

---

## Paste-ready (under 4000 chars)

```
TEST ACCOUNT

Sign in with Apple is the only authentication. Please use any Apple ID — no pre-seeded test account needed. Private relay email and any display name are fine.

QUICK SETUP (under 3 minutes to a working state)

1. Sign in with Apple. A paywall appears on first launch (see "Subscription" below — free in sandbox).
2. Tap + on the warehouses screen to create a sample warehouse.
3. Tap + inside the warehouse to create a box (QR label auto-generated).
4. Box detail → Add items → Scan barcode (any kitchen product, EAN-13) or Manual entry. The EAN lookup auto-fills name, category, calories, and content weight.
5. Optional: Settings tab → READINESS → Household → "Add person" → pick a preset (e.g. Adult male). Tap "Readiness dashboard" to see coverage computed from inventory + household needs.

The bottom tabs inside a warehouse are: Boxes / Items / Scan / Shopping / Settings. The header bell aggregates open alerts (readiness, expiry, shopping) per-warehouse and cross-warehouse on the root screen.

PERMISSIONS

- Camera: scan box QR codes, product barcodes, attach item photos.
- Photo Library: attach photos or save item photos.
- Bluetooth: print QR labels to Brother label printers AND P2P sync with another iPhone (Apple MultipeerConnectivity uses both Bluetooth and Wi-Fi).
- Local Network: discover Brother printers on Wi-Fi AND P2P Bonjour discovery.
- Notifications: optional, only for local on-device expiry reminders. No remote push, no servers.

All permissions are requested lazily at point of use, never on launch.

SUBSCRIPTION (Tier 15, ~$14.99 USD / year, Apple Small Business Program enabled)

Free download. Mandatory paywall on first launch for users with no prior purchase history. Reviewers signing in with sandbox accounts will see the paywall after Apple Sign In — tap Subscribe to proceed; sandbox makes this free. Family Sharing enabled (one subscription covers up to 6 members). After cancellation/lapse, the app continues to work locally; only cloud sync, image upload, and AI are gated. Restore Purchases available on the paywall and in Profile → Subscription.

AI FEATURE (BYOK)

AI-assisted product recognition is OFF by default. It activates only when the user adds their own Anthropic API key in Settings → AI. Reviewer can skip — the app works fully without it.

THIRD-PARTY SERVICES

- Apple (Sign in with Apple)
- Supabase (backend database + image storage, hosted in Ireland, EEA)
- Open Food Facts (public barcode lookup, France — only the barcode number is sent)
- Anthropic (optional AI, USA — only with user-provided key)

No analytics, no ads, no tracking SDKs.

REVIEWER-FACING QUIRKS

- P2P Sync requires two iPhones. With one device the screen opens and starts advertising but cannot complete a pair.
- QR label printing requires a Brother Bluetooth printer. The print UI renders without one; "Select printer" needs a paired device to complete.
- A brief "Syncing…" banner may appear on first launch — expected.

CONTACT

Ondřej Michalčík — ondrej.michalcik@gmail.com — typical response within 24h (CET business days).

Privacy: https://kalta.app/privacy · Terms: https://kalta.app/terms · Support: https://kalta.app/support
```

(~3700 chars, fits the 4000 ASC limit with headroom.)

---

## Test account

**Sign in with Apple** is the only authentication method. Please use **any Apple ID** of your choice — the app works for any account, no pre-seeded test account is needed.

We do not require email or name from your Apple ID; you can use a private relay email and any display name.

Once signed in, you can:

1. Tap **+** on the warehouses screen to create a sample warehouse.
2. Tap **+** inside the warehouse to create a sample box (a QR label is generated automatically).
3. Open the box → **Add items** → either **Scan barcode** (any kitchen product with an EAN works — the open public database fills in name + nutrition automatically) or **Manual entry** for a few sample items with expiration dates.
4. *Optional, demos the readiness loop*: Settings tab → READINESS → Household → tap "Add person" and pick a preset (e.g. Adult male). Then tap "Readiness dashboard" to see the coverage view computed from the items just added.

This produces a fully working app state in under three minutes for the review.

The demo data shown in the App Store screenshots was generated this way for illustration purposes.

---

## Feature walkthrough

A full review can be done in ~5 minutes:

1. **Launch app** → Sign in with Apple (demo account above).
2. **Dashboard** — see warehouses sorted by urgency. A header bell appears with a colored dot when something needs attention (expiring items across all warehouses); tap to see the alert card.
3. **Open a warehouse** → see boxes sorted by earliest expiry. Bottom tabs: **Boxes / Items / Scan / Shopping / Settings**. Header bell here is scoped to this warehouse and aggregates readiness, expiry, and shopping signals.
4. **Open a box** → see items color-coded by expiry, with status badges (OPENED / DAMAGED / OUT / LOW).
5. **Scan a barcode** — Scan tab or QR button on a box. The scanner recognizes EAN-13 codes from any kitchen product; the lookup auto-fills name, category, calories, and content weight.
6. **Add an item manually** — box detail → Add items → tap **Manual entry** (skip scan). The form has a **More details** expander for optional nutrition and low-stock threshold.
7. **Readiness dashboard** — Settings tab → Readiness dashboard. Shows total days of food and water computed from inventory + household needs, color-coded against the goal. Below: 24-item emergency kit checklist with lifecycle states (missing / on shopping list / purchased / stocked).
8. **Shopping list** — Shopping tab. Tap **Refresh suggestions** to auto-populate from expired items, low-stock items, and missing emergency kit entries. Check an item off → it moves to the "Ready to restock" section → tap "Restock" to put it back into a box in two taps.
9. **Share a warehouse** — warehouse Settings → Invite → generates a link. The shopping list and readiness data are shared across all members.
10. **P2P sync** — Settings → P2P Sync → Start searching. Requires two devices to test.
11. **Print QR label** — box detail → Print QR → requires a Brother Bluetooth printer to test.

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
