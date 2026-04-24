# Warehouses, boxes & items

Kalta organizes your supplies in three levels: **warehouses** contain **boxes**, and boxes contain **items**. This page explains how each level works and how to decide on your own structure.

## The hierarchy

<div class="screenshot">[Screenshot: Dashboard → Warehouse → Box detail side-by-side]</div>

- **Warehouse** — a physical location or logical group. Usually 1–3 per household.
- **Box** — a physical container inside a warehouse. Each has its own QR label.
- **Item** — a single product line inside a box (e.g., "Canned beans x4, expiring 2027-12").

Nothing stops you from putting everything in one warehouse. The hierarchy is there so that when you add a second physical location, or want to share one but not the other, you have room to separate.

## Warehouses

### When to use multiple warehouses

Most people start with one warehouse for their whole home and never need more. Create a second warehouse when:

- You store supplies in a **physically separate location** that you sometimes need to manage independently (e.g., "Cabin in the woods", "Office emergency kit", "Grandma's basement").
- You want to **share one but not another** — for example, share "Home pantry" with your partner but keep "Personal first-aid kit" private.
- You're tracking **different kinds of stock**, like "Food" vs "Medical" vs "Tools", and the split is cleaner than trying to tag items.

### Renaming, deleting

From a warehouse's **Settings** tab:

- Rename — just change the name and save.
- Delete — only the owner can delete, and deleting also removes all boxes, items, and member records. This is irreversible after a short undo window.

## Boxes

A box is a physical container inside a warehouse. Every box gets a **unique QR code label** generated automatically.

### The QR code flow

1. You create a box in Kalta.
2. Kalta generates a QR label and shows it on screen.
3. You print, hand-write, or share the QR somehow (see [Printing](/docs/printing)).
4. You stick the label on the physical box.
5. Later, you scan any box's label to jump straight to its contents in the app.

This is the core mechanic that makes Kalta feel different from a generic list app. You never have to think "which list was this in?" — the physical box tells you.

### Naming boxes

Short, concrete names work best:

- **Good**: "Canned food", "Medical", "Batteries & flashlights", "Water (1L bottles)".
- **Avoid**: "Stuff", "Emergency A", "Box 1" — these give you no information when you see them on the dashboard.

### Sorting on the dashboard

Inside a warehouse, boxes are sorted **by expiry urgency**. A box with an item expiring next week appears above a box full of items expiring in three years. That way, when you open the warehouse, the most attention-demanding box is at the top.

Within a box, items are sorted the same way.

## Items

An item represents one product in one box. It has the following fields:

- **Name** — required. Usually filled in by barcode scan.
- **Quantity** — how many units of this exact product are in the box.
- **Barcode** — filled in automatically when you scan, optional if added manually.
- **Category** — e.g., "Canned food", "Medical", "Battery". Used for filtering later.
- **Expiration date** — optional but recommended for anything perishable.
- **Notes** — free-text for anything useful ("rotated from main pantry 2026-03", "opened on ...").
- **Photo** — optional. Attach a product photo or a receipt.

<div class="screenshot">[Screenshot: Item edit sheet with all fields visible]</div>

### Editing, deleting, moving

Tap any item to edit its fields. Standard iOS gestures work:

- **Swipe left** on an item row to delete.
- **Swipe right** to mark as opened (see below).

To **move an item to a different box**, open the item → change the box picker at the top of the edit sheet.

### The "opened" state

When you open a pack of something and start using it, swipe right on the item to mark it as **opened**. This moves the item up in sort order — opened items appear first because they typically have a shorter effective shelf life.

The "Items" tab at the warehouse level shows opened items first, across all boxes. Handy when you want to see "what's currently in use".

## Custom products

Not every product is in the Open Food Facts database. When you scan a barcode and Kalta doesn't find a match, you can fill in the product details manually — and Kalta saves them as a **custom product**. Next time you scan the same barcode, the custom product loads automatically.

Custom products are tied to your account and shared across warehouses.

## Deletion and data safety

- Deleting an item moves it to a soft-deleted state for a short period, then permanently removes it.
- Deleting a box permanently removes its items.
- Deleting a warehouse permanently removes everything inside it.

There's no trash can — be intentional about deletion. If you think you might want something back, archive it (mark it as deleted) rather than waiting for the background purge.

## What's next

- If you haven't started scanning yet, read [Scanning and AI](/docs/scanning-and-ai).
- If you plan to share your warehouse with a family member, jump to [Sharing & P2P sync](/docs/collaboration).
