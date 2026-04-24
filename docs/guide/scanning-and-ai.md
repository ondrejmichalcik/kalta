# Scanning and AI

Kalta is built around scanning. There are two kinds: scanning a **box QR label** to jump into a box, and scanning a **product barcode** to add an item. There's also an optional AI feature that can identify a product from a photo when neither works.

## The Scan tab

Inside any warehouse, the **Scan** tab opens the camera. It recognizes two types of codes automatically:

- **QR codes** on box labels — jumps you straight into the box detail screen.
- **Product barcodes** (EAN-13, EAN-8, UPC-A, UPC-E) — starts a "new item" flow in the current box (or asks which box if you're at the warehouse level).

<div class="screenshot">[Screenshot: Scanner UI with both code types recognized]</div>

You don't have to pick which type to scan — Kalta figures it out from the content.

## Adding items inside a specific box

If you already know which box you're filling, open that box first. From box detail, tap **Add items**.

You have three options:

1. **Scan barcode** — opens the scanner in "this box" mode.
2. **Manual entry** — fill in fields by hand, no barcode needed.
3. **Suggest with AI** — if enabled (see below), take a photo and let Claude Vision identify the product.

In "this box" scanner mode, you can **keep scanning** — Kalta adds each scanned item to the box without exiting, so you can go through a shopping bag and scan each item in a row.

## Open Food Facts: the barcode database

When you scan a product barcode, Kalta looks it up in [Open Food Facts](https://world.openfoodfacts.org), a public crowdsourced database of food products worldwide.

- **What's sent**: only the barcode number.
- **What comes back**: product name, category, brand, sometimes a photo and nutrition info.
- **Coverage**: excellent for European packaged food (~85%+ hit rate), weaker for American brands, much weaker for non-food items and private-label store brands.

If the product is found, Kalta pre-fills the item fields. All you add is quantity, expiration date, and optional notes.

If the product is **not found**, Kalta shows "Unknown product" and asks you to fill in fields manually.

## When barcode lookup fails: custom products

For any barcode that doesn't resolve, fill in the fields yourself the first time. Kalta saves what you entered as a **custom product** tied to your account.

Next time you scan the same barcode, your custom entry loads automatically. You effectively teach Kalta about your local store brands.

## AI-assisted product recognition (Claude Vision)

The AI feature is **optional and off by default**. When enabled, it lets you:

- Take a photo of a product (box, can, bottle, medicine packaging, battery pack — anything).
- Kalta sends the photo to Anthropic's Claude Vision API.
- The AI extracts product name, category, and an estimated typical shelf life.

### Why BYOK (bring your own key)

Kalta doesn't host this feature on a shared backend. Instead:

- **You create a free Anthropic account** at https://console.anthropic.com.
- **You generate your own API key** from the Anthropic console.
- **You paste the key into Kalta Settings → AI**.
- **You pay Anthropic directly** for the tiny per-scan cost.

This keeps the app privacy-respecting (Kalta never sees your photos) and lets you control cost and usage.

### Cost per scan

At current Claude Haiku 4.5 pricing, a typical product photo costs **~$0.001–0.005** per scan. One dollar in API credit buys you hundreds of scans.

### How the key is stored

Your API key is stored **only in the iOS Keychain on your device** (via `expo-secure-store`). It never syncs to Kalta's backend or any other device. If you uninstall the app or switch iPhones, you'll need to add the key again.

### Setup walkthrough

1. Open https://console.anthropic.com → Sign up or log in.
2. Add **$5–10 of credit** to your account (pay-as-you-go). You can set a monthly cap from your Anthropic dashboard.
3. Click **API Keys → Create Key**. Copy the key (it's only shown once).
4. In Kalta → **Settings** → **AI** → paste the key → **Save**.

<div class="screenshot">[Screenshot: Kalta AI settings screen with "Paste API key" field]</div>

5. Test it: go to an unknown product, tap **Suggest with AI**, take a photo. You should see the fields pre-filled within a few seconds.

### Disabling it later

Remove the key from Settings → AI at any time. The feature immediately stops working; no call to Anthropic is made without a key.

## Tips

- **Light the product well** when scanning — the camera needs to see the barcode bars clearly. Harsh shadows or curved surfaces (tubes, bottles) trip up the reader.
- **Hold the phone ~15 cm from the barcode**. Too close and it can't focus; too far and the bars are too thin.
- **If AI suggestions are off**, you can still edit the fields manually before saving. The AI is a starting point, not a source of truth.
- **Custom products beat AI** for things you buy repeatedly. After you've manually entered a brand-of-X once, you'll never need to enter it again.

## Privacy

- **Barcode scans**: only the number goes to Open Food Facts (no identifier for you).
- **AI scans**: only happen with your own Anthropic key. Photos go directly from your device to Anthropic. Kalta is not involved after the key is saved.
- **Photos saved to items**: stored in our Supabase backend (Ireland, EU) as part of your inventory data. Only you and warehouse members see them.

For the full details, see the [Privacy Policy](/privacy).

## What's next

- Set up [expiry tracking and reminders](/docs/expiry-and-reminders) so Kalta reminds you before things expire.
- If you want to share a warehouse with family, read [Sharing & P2P sync](/docs/collaboration).
