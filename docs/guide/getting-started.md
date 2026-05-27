# Getting started

Welcome to Kalta. This guide walks you through the first five minutes with the app — enough to go from install to your first tracked item.

## What you need

- An iPhone running iOS 16 or later.
- An Apple ID (the same one you use for iCloud and the App Store is fine).
- Kalta installed from the App Store.

That's it — there are no other accounts to create. Kalta uses Sign in with Apple as the only sign-in method, so you don't need to think up a new password.

## 1. Sign in with Apple

Launch Kalta. You'll see the welcome screen with a single **Sign in with Apple** button.

<div class="screenshot">[Screenshot: Welcome screen with Sign in with Apple button]</div>

Tap it. iOS handles the authentication — you'll see Apple's standard dialog asking whether to share your email and name.

- **Email**: you can share your real email, or choose Apple's private relay (`...@privaterelay.appleid.com`) which forwards messages to your real inbox without revealing it.
- **Name**: Kalta only uses this as your display name visible to people you share warehouses with. You can pick any name — it doesn't have to match your Apple ID.

After you confirm, you land on the empty warehouses list.

## 2. Create your first warehouse

A *warehouse* in Kalta is a container for boxes. Most people start with a single warehouse for their whole home; you might add more later if you store supplies in separate locations (e.g., "Basement", "Car trunk", "Cabin").

Tap the **+** button at the bottom right.

<div class="screenshot">[Screenshot: Empty warehouses list with + button highlighted]</div>

Give your warehouse a name — something concrete like "Home pantry" or "Basement supplies". Tap **Create**.

You're now inside the warehouse. It has four tabs at the bottom: **Boxes**, **Items**, **Scan**, and **Settings**. Right now they're all empty.

## 3. Create your first box

A *box* is a physical container — a plastic tub, a cardboard box, a drawer, a shelf section. Anything that holds things you want to track.

In the warehouse, tap the **+** button (bottom right, again).

Give the box a name — "Canned food", "First aid", "Batteries". Tap **Create**.

Kalta generates a unique **QR code label** for this box. You'll see a preview of it on screen.

<div class="screenshot">[Screenshot: Newly created box with QR label preview]</div>

You can:

- **Print it** now if you have a supported Bluetooth label printer (see [Printing](/docs/printing)).
- **Share it** as an image via the iOS share sheet — send to your Mac, print on a regular inkjet, tape to the box.
- **Skip printing** and come back later — the QR is always available from the box detail screen.

Stick the label on the physical box. This is what makes Kalta feel magical later: you can scan any box's label to jump straight to its contents.

## 4. Add your first item

From the box detail screen, tap **Add items**.

You get two options:

- **Scan barcode** — uses the camera to read product barcodes (EAN-13 most commonly). Kalta looks the product up in a public database and pre-fills the product name, category, and sometimes a photo.
- **Manual entry** — for things with no barcode, or for products not in the database (more common for private-label store brands).

Scan your first product:

<div class="screenshot">[Screenshot: Barcode scanner UI with a can in frame]</div>

After a successful scan, Kalta fills in the product fields. All you need to add yourself:

- **Quantity** — how many of this thing you put in the box.
- **Expiration date** — check the packaging. Tap the date field to pick.
- **Notes** (optional) — anything useful, like "rotated from pantry 2026-04".

Tap **More details** if you want to verify or set the calories per 100g, content per item, or a low-stock threshold. For products scanned from the database these are usually pre-filled — they feed the [Readiness dashboard](/docs/readiness) so you can see how many days of supply you actually have.

Tap **Save**. The item appears in the box.

## 5. That's it — you have a working inventory

From here:

- **Scan more items** to fill the box.
- **Create more boxes** for other categories.
- **Check the main dashboard** — boxes and items are sorted by expiry urgency. The most critical stuff is at the top.
- **Set up your household** in Settings → READINESS → Household. Once Kalta knows how many people you feed and their daily calorie / water needs, the [Readiness dashboard](/docs/readiness) tells you how many days of supply you actually have.
- **Enable notifications** in Settings to get reminders before items expire.

For the full picture of what else Kalta can do, read through the rest of the docs.

## What's next

Most people's next step is understanding how warehouses, boxes, and items fit together — including when to create multiple warehouses and how to share them with your family. That's covered in [Warehouses, boxes & items](/docs/organizing).

If you'd rather see your inventory turn into something actionable — *"how many days am I covered for?"* — jump to [Readiness dashboard](/docs/readiness) and its companion [Shopping list & restock](/docs/shopping-and-restock).

If you want to set up the AI feature that identifies unknown products from photos, jump straight to [Scanning and AI](/docs/scanning-and-ai).
