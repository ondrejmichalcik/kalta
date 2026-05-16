# Paid app + financial setup walkthrough

Step-by-step guide to configure App Store Connect for selling Kalta as a paid app (Tier 10, $9.99) in the Czech Republic as an OSVČ.

**Private doc — not published on kalta.app.** This is your internal checklist.

---

## Before you start — gather this info

Open a note and have these values ready. Several screens in App Store Connect demand them back-to-back and session timeouts will force re-login.

### Identity

- **Full legal name:** Ondřej Michalčík
- **Address:** your Prague address (street + city + PSČ)
- **IČO:** 04801792
- **DIČ:** CZ8801235993
- **Email:** ondrej.michalcik@gmail.com
- **Phone:** your mobile (country code `+420`)

### Tax (W-8BEN)

- **Foreign TIN (Tax ID in your country):** `CZ8801235993` (DIČ) — this is what Apple asks for in the W-8BEN's "Foreign tax identifying number" field.
- **Date of birth:** for individual W-8BEN
- **Country of residence:** Czech Republic
- **Country of citizenship:** Czech Republic
- **Tax treaty article claim:** Czech Republic–US treaty, **Article 12 (Royalties)**, **0% rate** (explained below in the W-8BEN section).

### Bank

You need a **business bank account** (OSVČ recommended) or personal account that accepts EUR/USD incoming international transfers.

- **Bank name** (e.g., `Fio banka`, `Raiffeisenbank`, `ČSOB`, `Česká spořitelna`)
- **Bank address** (find it on your online banking or bank's contact page)
- **IBAN** (starts with `CZ` for Czech accounts, 24 characters)
- **SWIFT / BIC** (8 or 11 characters, e.g., `FIOBCZPPXXX`, `RZBCCZPP`, `CEKOCZPP`)
- **Account holder name** — must match the name on the App Store Connect account exactly (Ondřej Michalčík)
- **Currency** — Apple will pay in EUR (Eurozone region). Your account must accept EUR.

### Apple Developer Program

- ✅ Already paid ($99/year)
- ✅ Team: your individual developer account
- Bundle ID: `com.ondrejmichalcik.kalta` (already in use)

---

## Part 1 — Paid Applications Agreement

Without this signed, you cannot sell paid apps. Apple processes the agreement internally in 1–3 business days.

### Steps

1. Open https://appstoreconnect.apple.com → sign in.
2. Left sidebar → **Business** (dropdown) → **Agreements, Tax, and Banking**.
3. You should see:
   - **Free Apps Agreement** — ✅ already signed (accepted when you joined the Developer Program).
   - **Paid Applications** — "Not started" or "Request" button. Click **Request**.
4. Review the agreement terms (Apple is the legal agent/reseller for paid apps in most regions).
5. Tick **I have read and agree** → **Submit**.

### What happens next

The agreement enters **"In Progress"** state. It will only move to **"Active"** once you've completed:

- Tax forms (Part 2)
- Banking (Part 3)
- Contacts (Part 4)

You can do those in parallel — Apple won't activate the agreement until all three are green.

---

## Part 2 — Tax forms (W-8BEN for non-US individuals)

Apple uses W-8BEN (for individuals) to determine US withholding tax on your royalties. Czech Republic has a tax treaty with the US, so you can claim **0% withholding** instead of the default 30%.

### Steps

1. In **Agreements, Tax, and Banking**, click on the Paid Applications row → **Tax Forms**.
2. Apple asks "Do you have a US Taxpayer Identification Number (TIN)?" → **No** (you're a Czech tax resident).
3. It will direct you to the **W-8BEN** form (not W-9, not W-8BEN-E — those are for US residents and entities respectively).
4. Fill the form:

#### W-8BEN fields, line by line

| Line | Field | Your answer |
|---|---|---|
| 1 | Name of individual beneficial owner | `Ondřej Michalčík` |
| 2 | Country of citizenship | `Czech Republic` |
| 3 | Permanent residence address | your Prague street address, city `Prague`, postal code, country `Czech Republic` |
| 4 | Mailing address (if different) | leave blank |
| 5 | US TIN (SSN / ITIN) | **leave blank** |
| 6a | Foreign tax identifying number | `CZ8801235993` (your DIČ) |
| 6b | Check if no Foreign TIN legally required | leave unchecked |
| 7 | Reference number | leave blank |
| 8 | Date of birth | `MM-DD-YYYY` format (US order) |

#### Part II — Treaty claim (this is the 0% withholding part)

- **Line 9:** "I certify that the beneficial owner is a resident of **Czech Republic** within the meaning of the income tax treaty between the United States and that country."
- **Line 10:** Special rates and conditions:
  - **Article number:** `12` (Royalties)
  - **Rate:** `0%`
  - **Type of income:** `Royalties (software)` — Apple's payments are classified as royalties for apps
  - **Explanation:** You can write something like: *"Royalties for software sales distributed via Apple App Store. The beneficial owner is a resident of the Czech Republic and the royalties are not effectively connected with a US trade or business."* (Apple's form may or may not accept your text — if it accepts without, leave blank.)

#### Certification

- Sign electronically (Apple's form has a signature field)
- Date: today
- "I certify that I am the beneficial owner" → ✅
- Capacity if acting as agent: leave blank (you're not)

### Submit

Apple auto-validates the form. It typically takes **1–2 business days** to show **"Active"** status on the tax section.

### Common gotchas

- **Wrong Article number** → some people put `7` (Business Profits) — that's wrong for Apple sales. Use `12` (Royalties).
- **Leaving Article blank** → Apple defaults to 30% withholding. You'd lose a third of every sale.
- **Date format** → US forms use `MM-DD-YYYY`. Don't use Czech `DD.MM.YYYY`.

---

## Part 3 — Banking

### Steps

1. Back in **Agreements, Tax, and Banking** → Paid Applications row → **Banking**.
2. Click **Add Bank Account**.
3. Country: **Czech Republic** → Currency: **EUR** (Apple pays most non-US sellers in EUR).
4. Fill fields:

| Field | Value |
|---|---|
| Account holder name | `Ondřej Michalčík` (must match App Store Connect account name) |
| Account holder type | `Individual` |
| Bank name | your bank |
| Bank address | your bank's HQ address (from their website) |
| IBAN | your IBAN (starts with `CZ`, 24 chars, no spaces) |
| SWIFT / BIC | your bank's SWIFT (8 or 11 chars) |
| Intermediary bank | **not required** for most Czech banks — leave blank |

### Verification

Apple sends a small test deposit (usually €0.01–€0.10) within **2–5 business days**. You'll see it in your online banking. Apple may also ask you to confirm the amount in App Store Connect, but for many Czech accounts this is automatic.

### Common gotchas

- **Name mismatch** — most common reason for Apple to reject banking. The account holder name in your bank's records must match `Ondřej Michalčík` character-for-character. Check if your bank has you registered with accents or without, as firm or individual.
- **Business vs personal account** — Apple accepts both. For OSVČ, a business account is cleaner for accounting.
- **Currency of the account** — your Czech bank account doesn't have to be denominated in EUR. Most Czech banks auto-convert incoming EUR to CZK at their rate. If your bank charges a flat fee for EUR receipt (some do ~€5), that's per-payment, not per-sale. Apple pays **monthly** if you accumulate more than the minimum threshold (€10 in EU) — so fees are per month.

### Tip for zero-fee EUR accounts

If you want to receive EUR with no conversion fees, consider opening a **Wise Business** account (IBAN in multiple currencies). You can use it as your Apple bank and transfer to your main Czech bank on your terms. Completely optional.

---

## Part 4 — Contact info

Apple requires four separate contacts. For a solo OSVČ, all four are **you**. Fill each one identically:

1. **Senior Management contact** — CEO-type. You.
2. **Technical contact** — developer-type. You.
3. **Financial contact** — accounting-type. You.
4. **Legal contact** — legal/IP questions. You.

For each, paste:

- Name: Ondřej Michalčík
- Title: `Owner` or `Developer`
- Email: ondrej.michalcik@gmail.com
- Phone: +420 xxx xxx xxx

### Steps

1. **Agreements, Tax, and Banking** → Paid Applications → **Contact Information**.
2. Click each of the four roles → fill in the same info → Save.

---

## Part 5 — Apple Small Business Program enrollment

This is a **separate agreement** from Paid Applications. Enrolling drops Apple's commission from 30% to **15%** — effective from the calendar quarter following acceptance.

### Prerequisites

- Paid Applications Agreement must be submitted first (Part 1).
- Your developer account earned **less than $1,000,000 USD in the prior calendar year** (you certainly qualify — you've earned $0 so far).

### Steps

1. **Agreements, Tax, and Banking** → scroll down to **Apple Small Business Program**.
2. Click **Request**.
3. Read terms → ✅ agree → **Submit**.

### Activation timing

- If you enroll in **Q2 (Apr–Jun)**, the 15% rate starts **Q3 (Jul 1, 2026)** for all your apps.
- Sales between today and the activation date use the default 30% rate.
- **Plan**: enroll ASAP so the rate drop starts at the earliest quarter.

### Commission math at Tier 15 ($14.99 / year subscription)

- **Default 30%**: you get $10.49 per subscription/year (gross minus Apple's 30%).
- **SBP 15%**: you get $12.74 per subscription/year.
- Difference: **$2.25 per sub/year**. At 100 active subs, that's **$225/year** extra revenue.

**Why subscription instead of a one-time price:** Kalta has recurring per-user backend cost (Supabase hosting + cloud storage of images). A one-time $9.99 Tier 10 covered only ~2-3 years of hosting per user — after that the customer was subsidized indefinitely. The yearly subscription matches recurring revenue to recurring cost, and keeps the app sustainable at any scale.

---

## Part 6 — Create the app record + subscription product in App Store Connect

Before you can enable Family Sharing or generate offer codes, the app must exist as a record. The Kalta Cloud subscription product is configured under it.

### 6A — Create the app record

1. App Store Connect → **Apps** (top navigation).
2. Click **+** → **New App**.
3. Fill:
   - **Platform:** iOS
   - **Name:** `Kalta`
   - **Primary Language:** English (U.S.)
   - **Bundle ID:** select `com.ondrejmichalcik.kalta` from the dropdown (it must already exist in Certificates, Identifiers & Profiles, which EAS created when it built your first iOS app)
   - **SKU:** `KALTA-IOS-001` (arbitrary unique string for internal tracking)
   - **User Access:** Full Access
4. Click **Create**.

### 6B — Set app price to Free

1. In the app record → **App Information** → **Pricing and Availability**.
2. **Price:** Free.
3. Save.

The app itself is free; revenue comes from the in-app subscription below.

### 6C — Create the Kalta Cloud subscription product

1. In the app record → **In-App Purchases** (left sidebar) → **Manage**.
2. Click **+** under **Subscription Groups** → name: `Kalta Cloud` → Create.
3. Open the group → click **+** under Subscriptions:
   - **Reference Name:** `Kalta Cloud Yearly`
   - **Product ID:** `com.ondrejmichalcik.kalta.cloud_yearly` (must match `SUBSCRIPTION_PRODUCT_ID` in `src/lib/subscription.ts`)
   - **Subscription Duration:** 1 Year
   - **Price Schedule:** Tier 15 (~$14.99 USD)
   - **Family Sharing:** Enabled
   - **Localizations:**
     - **EN (en-US):** Display name `Kalta Cloud`. Description: *"Cloud sync across devices, multi-device shared warehouses, AI item recognition, and unlimited cloud image storage. Auto-renews yearly. Cancel anytime in App Store settings."*
     - **CS (cs):** Display name `Kalta Cloud`. Description: *"Cloud synchronizace mezi zařízeními, sdílené sklady, AI rozpoznávání položek a neomezené úložiště fotek. Obnovuje se ročně. Lze kdykoli zrušit v nastavení App Store."*
   - **Review Information:**
     - **Screenshot:** Paywall screen showing Subscribe button and auto-renewal disclosure.
     - **Review Notes:** "Mandatory paywall on first launch. Sandbox Apple ID makes subscribe free. Cancel any time via iOS Settings."
4. Save → status will go to **Ready to Submit**. It does not need to be Approved separately — it ships with the next app version review.

### 6D — Mirror the storekit config

Make sure `storekit/Kalta.storekit` in the repo still matches the ASC product (product ID, period, price tier, Family Sharing). The .storekit file is only used for simulator testing, but keeping it in sync avoids surprises when switching between sandbox and ASC.

---

## Part 7 — Enable Family Sharing

### Steps

1. In the app record → **App Information** (left sidebar under General).
2. Scroll down to **Additional Information** section.
3. Find **Family Sharing** toggle → **Enable**.
4. Save.

### What this does

- Your **Kalta Cloud subscription** ($14.99/year) is shared with members of your Apple Family Sharing group.
- Your wife, when added to your Family group, gets full app access for free as long as your subscription is active.
- Works for up to **6 family members** per Family group.

### Requirements for you

- Your Apple ID must be in a Family Sharing group (set up in iOS Settings → Family Sharing).
- Your wife's Apple ID must be added to the same group by you (Family Organizer).

### Setting up the Family Sharing group

If you haven't already:

1. On your iPhone: Settings → [Your name] → **Family Sharing** → **Set Up Your Family**.
2. Add your wife: **Invite People** → via iMessage or AirDrop.
3. She accepts the invitation on her iPhone.
4. Done — once Kalta goes live and you buy it, she sees it as available.

---

## Part 8 — Offer codes for the subscription (after review approval)

Because Kalta is a free download with a subscription, the relevant Apple mechanism is **Offer Codes**, not Promo Codes. Offer Codes can grant a free intro period (e.g. 1 year) for the subscription, bypassing the initial charge. After the intro period the subscription auto-renews at the normal price unless the recipient cancels.

Offer codes become available **after the subscription product is in "Ready to Submit" state** (which happens once the Paid Applications Agreement is active and you've configured the product in Part 6C).

### Setting up an offer code

1. App Store Connect → Apps → Kalta → **In-App Purchases** → open the `Kalta Cloud Yearly` subscription.
2. Scroll to **Subscription Offers** → click **+** under **Offer Codes**.
3. Configure:
   - **Reference Name:** e.g. `Family-Free-Year`
   - **Eligibility:** New subscribers, existing subscribers, or both
   - **Offer Type:** **Free** (the recipient pays nothing during the intro period)
   - **Duration:** 1 Year
   - **Codes:** generate a batch (up to 1 000 000 per quarter). Use Custom Codes for memorable single codes, or unique codes for distribution.
4. Optionally provide a distribution URL — Apple generates a one-tap redemption link.

### How recipient uses the code

- On iPhone → open **Kalta** → Paywall → **Restore** doesn't surface this; offer codes are redeemed differently:
  - Via the distribution URL Apple gave you, or
  - In **Settings → your name → Subscriptions → Add Offer Code**.
- After redemption the subscription becomes active for the intro period (1 year) at no charge.
- **Reminder:** to avoid being billed after the year, the recipient must cancel auto-renewal before the period ends, or generate a fresh code for them.

### For Ondřej + wife specifically

- **Wife:** add to Apple Family Sharing (Part 7). She gets full access for free as long as your subscription is active. No offer code needed.
- **You:** generate a `Free-1-Year` offer code for your real Apple ID and redeem it annually. Set a calendar reminder ~340 days out to cancel + redeem a fresh code, or just decide it's worth ~$2 net cost per year and let it bill normally (cleaner, no maintenance).

---

## Part 9 — Timelines and what to expect

| Step | Who waits | How long |
|---|---|---|
| Submit Paid Applications Agreement | Apple | Instant submit, internal review 1–3 business days |
| W-8BEN processing | Apple | 1–2 business days after submit |
| Bank verification | Apple + your bank | 2–5 business days (small test deposit) |
| SBP enrollment | Apple | Usually 1–2 business days |
| SBP rate activation | Calendar | Next quarter after enrollment (e.g., enroll in Q2 → active Q3) |
| Family Sharing | Immediate after toggle | Instant |
| Promo codes generation | After Apple approves v1.0 | ~24–72 hours of review time |

**Critical path to first sale**: Paid Apps Agreement + W-8BEN + Bank must all be **Active** before App Store can accept a paid submission.

So ideally: **start Parts 1–4 today**, then submit the app for review in 3–5 days.

---

## Part 10 — Common issues and fixes

### "Your Paid Applications Agreement is not yet active"

One of tax, bank, or contacts is incomplete. Go back to Agreements, Tax, and Banking and look for the red or gray status indicator next to each section.

### "We could not verify your bank account"

Usually name mismatch (see Part 3). Double-check the spelling, including diacritics. Edit the banking info → resubmit → Apple retries the test deposit.

### "Tax form review pending" stuck > 3 days

Email Apple Developer Support (https://developer.apple.com/contact/) via the **Paid Applications Agreement** category. Include your Team ID (find it in the top-right of App Store Connect). They respond within 1–2 business days.

### Family Sharing toggle is grayed out

Family Sharing must be enabled **before** the app is approved for App Store. You can toggle it during the first submission or any time after (but must re-submit a new build to activate the flag for existing downloads).

### "Your tax information is for a different country than your address"

You have Czech address on file but picked a non-Czech tax form (W-9 / W-8BEN-E). Restart the tax flow and pick **W-8BEN (Individual foreign person)**.

---

## What to do next (recommended order)

**Do this today:**

1. ✅ Submit Paid Applications Agreement (Part 1) — 5 min
2. ✅ Fill W-8BEN (Part 2) — 15 min — have your Czech Article 12 treaty claim ready
3. ✅ Fill Banking (Part 3) — 5 min
4. ✅ Fill Contacts (Part 4) — 5 min
5. ✅ Request Small Business Program (Part 5) — 2 min

Total active time: ~30 minutes. Then wait 3–5 days for Apple to activate everything.

**During that wait:**

- Build the TestFlight / App Store version (buildNumber 22+).
- Capture screenshots (Task 19 — we'll do that next).
- Create the App Store Connect app record (Part 6).
- Fill in app metadata from `docs/app-store/listing.md`.

**When agreements are active (3–5 days from now):**

- Enable Family Sharing on the Kalta app record (Part 7).
- Submit the build for review.
- Write App Review notes from `docs/app-store/review-notes.md` (fill in test Apple ID first).
- Wait 24–72 hours for Apple to approve.
- Generate promo codes (Part 8).
- **Done — Kalta is live on App Store.**

---

## Reference links

- App Store Connect: https://appstoreconnect.apple.com
- Agreements, Tax, Banking: https://appstoreconnect.apple.com/agreements
- Developer support: https://developer.apple.com/contact/
- Apple Small Business Program info: https://developer.apple.com/app-store/small-business-program/
- US–Czech tax treaty (Article 12): https://home.treasury.gov/system/files/131/Treaty-Czech-Republic-9-16-1993.pdf (skip to Article 12)
