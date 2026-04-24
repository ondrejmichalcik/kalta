# Printing QR labels

Every box in Kalta has a unique QR code. You stick it on the physical box so you can scan to jump into the box's contents later. This page covers how to actually produce those labels.

## Two ways to print

1. **Direct to a Brother Bluetooth label printer** — smoothest experience, real label tape, sticks well.
2. **Share as an image and print elsewhere** — works with any regular printer, or even hand-cut from a screenshot.

Both come from the same **Print QR** button on the box detail screen.

## Option 1: Brother Bluetooth label printer

Kalta integrates with the Brother Print SDK. Tested with:

- **Brother QL series** (QL-820NWB, QL-1110NWB, etc.) — dedicated label printers with rolls of pre-cut labels.
- **Brother PT (P-touch) series** (PT-P710BT, PT-P300BT, etc.) — "DIY label maker" style with continuous tape.

<div class="screenshot">[Screenshot: Print QR screen with Brother printer selected]</div>

### Pairing

1. **Turn on the printer** and put it in Bluetooth pairing mode (refer to your printer's manual — typically a button on the side).
2. iOS **Settings → Bluetooth** → find the printer → tap to pair. Complete any on-screen prompts.
3. Open Kalta → open a box → **Print QR** → **Select printer**.
4. Your printer should appear in the list. Tap it.

Kalta remembers the selected printer for next time.

### Printing

From the box detail screen:

1. Tap the **QR label preview** or the **Print** button.
2. Pick label size from the dropdown (options depend on what roll is loaded in your printer).
3. Tap **Print**.

A single label prints in ~2 seconds. Peel it off and stick it on the physical box.

### Label size guidance

- **Small labels (17×54 mm)** — fine if the QR is the only content. Scannable but tight.
- **Medium labels (29×90 mm)** — recommended. Room for the QR plus a readable human-readable box name.
- **Larger (62 mm continuous)** — for larger boxes where you want the label to be visible from across a room.

## Option 2: Share as image

If you don't have a Bluetooth label printer (or you prefer a regular printer or hand-labeling):

1. Open the box → tap the QR preview.
2. Tap the **share icon** (top right of the preview).
3. iOS share sheet opens:
   - **Save Image** — saves to your Photo Library; print from the Photos app later.
   - **AirDrop** — send to a Mac to print from there.
   - **Print** — if you have an AirPrint-compatible regular printer, print directly.
   - **Copy** — paste into Pages, Word, Notes, etc.

The exported image is a high-resolution PNG with the QR code and the box's name below.

### Practical tips for non-Brother printing

- **Print on label paper** (Avery, etc.) for easy peel-and-stick.
- **Or print on plain paper and tape over** — use packing tape covering the QR, which protects it from wear and moisture.
- **Make sure the QR is big enough** — at least 25×25 mm on the printed page. Smaller and phones struggle to focus on it.

## If the label gets damaged

QR codes have **error correction** built in, so they can still scan with up to ~30% of the pattern damaged (depending on the error correction level). Kalta uses **medium** error correction by default.

If a label is too damaged to scan:

- Open the box in Kalta (tap through the warehouse list) → reprint the label.
- Replace the damaged label with the new one.

You never lose the box's contents just because the label is damaged — the data lives in the app, not the label. The label is just a shortcut.

## What the QR encodes

Each QR contains a Kalta-specific URL like `kalta://box/{opaque-id}` (or `https://kalta.app/box/{id}` via Universal Links in the future). Scanning with iOS's built-in camera app will prompt to open Kalta; scanning from within Kalta jumps directly into the box.

Nothing sensitive is in the QR — just an opaque ID that only someone with access to your warehouse can use.

## Troubleshooting

### Printer not found during pairing

- Printer must be on and in pairing mode (often indicated by a blinking LED).
- iOS Settings → Bluetooth — printer must appear as a paired device before Kalta can select it.
- Some older Brother firmware requires a button press on the printer to confirm pairing. Consult the manual.

### Prints blank or truncated labels

- The label size chosen in Kalta must match the roll loaded in the printer.
- Reload the label roll (some Brother printers misalign after a paper jam).

### Printer disappears after a while

- Bluetooth connections time out. Open Kalta, tap **Select printer**, pick your printer again. Kalta re-establishes the connection.

### No Brother printer and no printer at all

- Use the **share as image** path and print from a nearby library, co-working space, or office printer.
- Or hand-write a unique short code on the box that matches the box name in Kalta. You lose the scan-to-jump magic, but the app still tracks the contents.

## What's next

This is the last core feature page. For a global view of what's in the docs, return to [Docs overview](/docs) — or jump back to [Getting started](/docs/getting-started) for a refresher on the basics.
