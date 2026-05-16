# App Privacy Questionnaire — Expected Answers

Reference for filling in App Store Connect → App Privacy. Answers are based on the data-handling audit of the Kalta codebase.

---

## Section 1: Does your app collect data?

**Yes.**

Rationale: We collect Apple ID email (if shared), display name, user-generated inventory content (items, boxes, photos), and a user identifier. This is stored on our Supabase backend.

---

## Section 2: Data types collected

For each item below, mark as collected and note purpose + whether it's **linked to the user** and whether it's **used to track**.

### Contact Info

#### Email Address
- **Collected:** Yes
- **Purpose:** App Functionality (account authentication and sharing invitations)
- **Linked to user:** Yes
- **Used for tracking:** **No**

*(Note: Apple's Sign In with Apple private relay is supported — in those cases, the email we see is a relay address.)*

#### Name
- **Collected:** Yes (only first time, if the user shares it via Apple Sign In)
- **Purpose:** App Functionality (display name shown to other warehouse members)
- **Linked to user:** Yes
- **Used for tracking:** **No**

#### Phone Number — **Not collected**
#### Physical Address — **Not collected**
#### Other User Contact Info — **Not collected**

---

### Health & Fitness — **None collected**

---

### Financial Info — **None collected**

*(Kalta uses an auto-renewing subscription processed by Apple. We never see payment card details, billing address, or transaction history — Apple handles all of that and only reports aggregate sales numbers to us in App Store Connect.)*

---

### Location

#### Precise Location — **Not collected**
#### Coarse Location — **Not collected**

---

### Sensitive Info — **None collected**

---

### Contacts — **Not collected**

---

### User Content

#### Photos or Videos
- **Collected:** Yes
- **Purpose:** App Functionality (product/item photos the user attaches)
- **Linked to user:** Yes
- **Used for tracking:** **No**

#### Audio Data — **Not collected**

#### Gameplay Content — **Not collected**

#### Customer Support — **Not collected**

*(Support correspondence is via email and not logged in-app.)*

#### Other User Content
- **Collected:** Yes
- **Purpose:** App Functionality (item names, notes, warehouse / box names)
- **Linked to user:** Yes
- **Used for tracking:** **No**

---

### Browsing History — **Not collected**

---

### Search History — **Not collected**

---

### Identifiers

#### User ID
- **Collected:** Yes (stable opaque ID generated on first sign-in)
- **Purpose:** App Functionality (authentication, ownership of data)
- **Linked to user:** Yes
- **Used for tracking:** **No**

#### Device ID — **Not collected**

*(We do not collect IDFA or IDFV.)*

---

### Purchases

#### Purchase History
- **Collected:** Yes
- **Purpose:** App Functionality (gates cloud sync, image upload, and AI features on an active Kalta Cloud subscription; triggers 30-day cleanup of cloud data after lapse)
- **Linked to user:** Yes
- **Used for tracking:** **No**

*(We store only the subscription's `expires_at` timestamp linked to the user record. We do not store SKU history, billing dates, refund history, or any payment instrument — Apple holds all of that.)*

---

### Usage Data — **Not collected**

*(No analytics, no screen view tracking, no session tracking.)*

---

### Diagnostics — **Not collected**

*(No crash reporting, no performance monitoring.)*

---

### Other Data — **Not collected**

---

## Section 3: Third-party SDKs

Kalta does not use any third-party advertising or analytics SDKs.

**Apple frameworks used** (not treated as third-party by Apple): AuthenticationServices (Sign in with Apple), MultipeerConnectivity, CoreBluetooth, UserNotifications.

**Third-party libraries** (open-source, no data collection by the library itself):
- Supabase JS client — talks to our own Supabase project.
- Expo + React Native core modules — no telemetry in production builds.
- Brother Print SDK — local Bluetooth only.

---

## Section 4: "Data Used to Track You" (Apple's definition)

**"Tracking" answer: NO — Kalta does not track users.**

Apple defines "tracking" as linking user/device data to third-party data for targeted ads, sharing with data brokers, etc. Kalta does none of this.

Because the answer to "Used for tracking" is No for every data type, Apple will not require you to implement App Tracking Transparency (ATT) prompt.

---

## Section 5: Optional feature disclosure — Anthropic Vision

The AI feature is **opt-in and BYOK** (user brings their own Anthropic API key). Technically, Apple does not require this to be listed in App Privacy because:

1. Kalta does not transmit data to Anthropic — the user does, using their own API key.
2. The user explicitly configures the feature.

**However**, to be fully transparent to reviewers and users, Anthropic is disclosed in:

- The Privacy Policy (Section 6 — Service Providers)
- The Terms of Service (Section 8 — BYOK AI feature)
- In-app disclosure on the AI settings screen when adding the key

---

## Summary

| Question | Answer |
|---|---|
| Collects any data? | Yes |
| Uses data to track? | **No** |
| Shows privacy nutrition label? | Yes — "Data Linked to You" only (no "Data Used to Track You") |
| Requires ATT prompt? | **No** |

**Privacy Nutrition Label preview:**

```
Data Linked to You
┌──────────────────────┐
│  Contact Info        │ (email, name)
│  User Content        │ (photos, other)
│  Identifiers         │ (user ID)
│  Purchases           │ (subscription expiration)
└──────────────────────┘

Data Not Linked to You: none
Data Used to Track You: none
```

Still one of the friendliest nutrition labels possible for an app that has any backend — use it in marketing copy ("Zero tracking. Data linked only for sharing and subscription state, nothing else.").
