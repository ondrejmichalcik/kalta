# Privacy Policy

**Effective date:** 2026-04-24
**Last updated:** 2026-05-16

This Privacy Policy describes how the Kalta iOS app ("Kalta", "the app", "we", "our") collects, uses, and shares information when you use the app.

Kalta is a personal home inventory tracker designed for emergency supplies, focused on privacy. We do not run any analytics, advertising networks, or tracking tools. The app stores your data locally on your device and syncs it to a backend database that only you and people you explicitly invite can access.

---

## 1. Data Controller

The data controller responsible for your personal data is:

**Ondřej Michalčík**
Self-employed (OSVČ) based in Prague, Czech Republic
IČO: 04801792
DIČ: CZ8801235993

Email: **ondrej.michalcik@gmail.com**

If you are in the European Economic Area (EEA), you can contact us at the email above for any question, request, or complaint regarding your personal data under the General Data Protection Regulation (GDPR).

---

## 2. Summary of what we collect

- **Apple ID info** you allow at sign-in (email and name).
- **Your inventory content** — warehouses, boxes, item names, expiration dates, optional photos, optional notes.
- **Subscription status** — your Kalta Cloud subscription expiration date, linked to your account ID. Used to enforce active access to cloud features and to delete cloud copies 30 days after lapse. The actual payment is processed by Apple — we never see your card details, billing address, or transaction history.
- **Device permissions** you grant (camera, photo library, Bluetooth, local network, notifications).
- **Optional**: if you choose to enter an Anthropic API key for AI-assisted product recognition, product photos you scan are sent to Anthropic with your key.

We do **not** collect:

- Advertising identifiers.
- Location data.
- Contacts.
- Microphone audio.
- Crash reports or analytics.
- Any third-party tracking data.
- Payment card details, billing addresses, or transaction history (Apple processes all payments).

---

## 3. Information we collect

### 3.1 Account information (Apple Sign In)

When you sign in with Apple, we receive and store:

- Your **Apple user identifier** (a stable, opaque ID provided by Apple).
- Your **email address** — if you choose to share it. Apple lets you use a private relay email (`...@privaterelay.appleid.com`) that forwards to your real address without revealing it to us.
- Your **full name** — only the first time you sign in, and only if you choose to share it. We store this as your display name, which is visible to other users you share warehouses with.

You can sign out at any time. If you sign out and later sign in again with the same Apple ID, your data is restored.

### 3.2 Inventory content (user-generated)

Kalta stores the inventory content you create, including:

- **Warehouses**: name, creator.
- **Boxes**: name, generated QR code, optional location label.
- **Items**: name, quantity, barcode, category, expiration date, optional notes, optional photo.
- **Custom products** you add manually (product name, barcode, category).
- **Inventory sessions**: record of what you added, when, and who added it (shared warehouses).
- **Warehouse membership**: list of users who have access to each shared warehouse, their role (owner or member), and when they joined.
- **Invitations**: time-limited tokens you generate to invite someone to a shared warehouse.

### 3.3 Device-stored data

Kalta is **offline-first**. Your data lives on your device in a local SQLite database and syncs to the backend when online. We also store:

- A **cached user ID** in your device's AsyncStorage, so you can continue using the app offline without signing in again.
- A **cached image folder** in your device's document directory, so your item photos load quickly and work offline.
- Your **Anthropic API key** (if you chose to enter one) in the iOS Keychain (via `expo-secure-store`). This key never leaves your device except when the app directly calls the Anthropic API to analyze a photo you are scanning.

### 3.4 Permissions requested by the app

| Permission | Why we ask | When |
|-----------|-----------|------|
| **Camera** | Scan box QR codes, scan product barcodes, take item photos | When you first open the scanner or take a photo |
| **Photo Library** | Attach photos from your library to items; save item photos to your library | When you first pick or save a photo |
| **Bluetooth** | Print QR labels to a Brother label printer; P2P sync with another iPhone | When you first use printer or P2P sync |
| **Local Network** | Discover a Brother printer on WiFi; discover a nearby iPhone for P2P sync | When you first use printer or P2P sync |
| **Notifications** | Local reminders for expiring items | When you enable expiry notifications in Settings |

Every permission is **optional**. You can revoke any of them in iOS Settings → Kalta at any time, and the app will continue to work with reduced functionality.

---

## 4. How we use your information

We use the data described above only to provide the app's functionality:

- Authenticate you and keep you signed in.
- Store and sync your inventory across your devices.
- Share warehouses with people you explicitly invite.
- Notify you locally when items are about to expire.
- Analyze a product photo (only if you have configured Anthropic Vision and are actively scanning).

We do **not**:

- Sell or rent personal data.
- Share data with advertisers.
- Track you across apps or websites.
- Profile you for marketing purposes.

---

## 5. Legal basis for processing (GDPR)

If you are located in the EEA, the UK, or Switzerland, we rely on the following legal bases under the GDPR to process your data:

- **Performance of a contract (Art. 6(1)(b))** — to provide you with the app after you accept the Terms of Service: authentication, syncing your inventory, delivering warehouse sharing.
- **Legitimate interests (Art. 6(1)(f))** — limited, specific cases such as securing the service and operating core infrastructure.
- **Consent (Art. 6(1)(a))** — for local expiry notifications (you opt in) and for the optional Anthropic Vision feature (you opt in by entering an API key).

You can withdraw consent at any time by disabling the feature or deleting the app.

---

## 6. Service providers and data processors

We use the following third parties to operate Kalta. They process data on our behalf under data processing agreements or equivalent contractual terms.

### Apple Inc. (USA / EU)
- **What**: Sign in with Apple authentication; delivery of the app via App Store and TestFlight.
- **Data**: Apple user identifier, the email you chose to share at sign-in.
- **Privacy policy**: https://www.apple.com/legal/privacy/

### Supabase (Ireland, EEA)
- **What**: Hosting of our backend database and user-uploaded product images.
- **Data**: Everything listed in Section 3.2 plus your user ID and email.
- **Location**: Our Supabase project is hosted in **Ireland (eu-west-1)**. Data is processed within the EEA.
- **Privacy policy**: https://supabase.com/privacy

### Open Food Facts (France / non-profit)
- **What**: Barcode-to-product lookup. When you scan a barcode, the app sends the barcode number to Open Food Facts to retrieve publicly available product information.
- **Data sent**: The barcode number only. No identifier tied to you.
- **Privacy policy**: https://world.openfoodfacts.org/privacy

### Anthropic, PBC (USA) — optional, opt-in
- **What**: AI-assisted recognition of product name, category, and typical shelf life from a photo.
- **When**: Only if you have configured an Anthropic API key in the app's AI settings and only for photos you actively scan using the AI feature.
- **Data sent**: The image you are scanning, dimensions, and your Anthropic API key in the request header. The image is sent to Anthropic's API at `api.anthropic.com`.
- **Location**: United States. See Section 7 for information on international transfers.
- **Your Anthropic account governs data retention on Anthropic's side.** Kalta does not have access to your Anthropic account.
- **Privacy policy**: https://www.anthropic.com/legal/privacy

---

## 7. International data transfers

All core app data (authentication, inventory, shared warehouses, photos) is stored with Supabase in **Ireland, EEA**. No cross-border transfer is required for core functionality.

If you choose to enable **Anthropic Vision** by entering your own Anthropic API key:

- Images you scan with that feature are sent to Anthropic in the **United States**.
- This constitutes an international transfer outside the EEA.
- Anthropic is participating in the **EU-U.S. Data Privacy Framework**, which provides an adequacy mechanism recognized by the European Commission.
- You can disable the feature at any time by removing your API key from the app's AI settings.

---

## 8. Peer-to-peer (P2P) sync

Kalta includes a P2P sync feature that lets two nearby iPhones exchange inventory data directly over Bluetooth and WiFi using Apple's MultipeerConnectivity framework, without going through our backend.

- The connection is **encrypted end-to-end** using TLS (Apple's MCSession with `encryption: required`).
- The exchanged payload contains your local inventory data (warehouses, boxes, items, and the identifiers of warehouse members you share with).
- Pairing requires both devices to be on the same P2P Sync screen at the same time. The receiving device accepts connections from any nearby device running Kalta with the same P2P Sync screen open.
- Before confirming a connection, verify the device name shown in your peer list matches the device you intend to sync with. Only sync with devices you recognize — for example, a family member's iPhone.

---

## 9. Sharing a warehouse with another user

You can share any warehouse with another Kalta user by generating an invitation link from the warehouse's Settings screen.

- The invitation is a time-limited, one-time token (valid 7 days) tied to that warehouse.
- Anyone who opens the link in Kalta and signs in can accept the invitation and join the warehouse.
- Once accepted, the invitee gains access to all contents of that warehouse (boxes, items, notes, photos) and sees the display names of other members.
- You can remove a member at any time from the warehouse's Settings, which revokes their access immediately.

**You are responsible** for sharing invitation links only with people you trust.

---

## 10. Data retention

- **Account data** is retained as long as your account exists.
- **Inventory data** is retained as long as your Kalta Cloud subscription is active or within **30 days after the subscription lapses**. After that, server-side cleanup permanently deletes cloud copies of warehouses, items, and images for which all members' subscriptions have been expired for at least 30 days. **Local data on your device is never affected by this cleanup** — you keep using the app locally as long as you have ever subscribed in the past.
- **Shared warehouse rule:** A warehouse stays in the cloud as long as at least one of its members holds an active subscription. The 30-day TTL only kicks in when every member has been lapsed for that long.
- **Product images** uploaded to Supabase Storage follow the same rule: bound to the warehouse they belong to. Deleting an item triggers image removal on the next cleanup cycle.
- **Subscription status** (your expiration date) is retained until you delete your account. After deletion, it is purged with the rest of your account data.
- **Local device data** is retained until you delete the app or sign out of a device. Signing out clears cached user data from that device.

If you ask us to delete your account (see Section 11), we delete your user record and its associated warehouses (where you are the owner) within 30 days.

---

## 11. Your rights

If GDPR or similar law applies to you, you have the following rights:

- **Access** — ask us what personal data we hold about you.
- **Rectification** — ask us to correct inaccurate data.
- **Erasure ("right to be forgotten")** — ask us to delete your account and associated data.
- **Portability** — ask us for an export of your inventory data.
- **Restriction** and **objection** — ask us to limit or stop processing in specific circumstances.
- **Withdraw consent** — for processing based on consent.
- **Lodge a complaint** with your local Data Protection Authority. In the Czech Republic, this is the **Úřad pro ochranu osobních údajů (ÚOOÚ)** — https://www.uoou.cz.

To exercise any right, email **ondrej.michalcik@gmail.com** from the email address tied to your account (or, if you used Apple private relay, include enough information for us to identify your account). We respond within 30 days.

---

## 12. Children's privacy

Kalta is not directed at children under 13 (or the equivalent minimum digital consent age in your country). We do not knowingly collect personal data from children. If you believe a child has used the app, contact us and we will delete the associated account.

---

## 13. Security

- All network traffic uses HTTPS/TLS.
- P2P sync uses TLS-encrypted Multipeer sessions.
- Authentication is handled by Apple — we never see your Apple password.
- Your Anthropic API key (if set) is stored only in the iOS Keychain on your device.
- Supabase encrypts data at rest and in transit.

No system is perfectly secure. If you suspect unauthorized access to your account, email us and we will assist.

---

## 14. Changes to this policy

We may update this Privacy Policy to reflect changes in the app or in applicable law. Material changes are announced:

- In the app (an update prompt on first launch after the change), and
- By updating the "Last updated" date at the top of this document.

Continuing to use Kalta after a change means you accept the updated policy.

---

## 15. Contact

Questions, requests, or complaints:

**Ondřej Michalčík**
Email: **ondrej.michalcik@gmail.com**