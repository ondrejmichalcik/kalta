# Shopping list & restock

Kalta's shopping list closes the loop from **"something's missing"** to **"it's back in the box"**. It's a synced per-warehouse list shared with everyone who has access, with one feature you won't find in a generic grocery app: a **restock flow** that creates inventory items from things you've checked off.

The list is its own tab in every warehouse. Tap **Shopping** in the bottom tab bar.

## The two sections

The list is split into two stacks:

- **To buy** — unchecked items, things you still need to pick up
- **Ready to restock** — items you've checked off in the store, now sitting in your bag, waiting to be put away

You move things between sections by tapping the checkbox on the left of a row (in **To buy**) or the bag icon (in **Ready to restock** acts as a visual marker; use the ⋯ menu to "Move back to To buy" if you mistapped).

<div class="screenshot">[Screenshot: shopping list with both sections visible]</div>

## Adding to the list

Three ways to get items on the list:

### Manual add

Tap **+** in the header → type a label → Add. Lands as `source: manual` with no extra metadata.

### From the readiness dashboard

In the **Emergency kit checklist**, tap any **Missing** chip → "Add to shopping list". The label and category come from the kit definition; source is `gap` with a link back to the kit entry.

### From an item edit sheet

Open any inventory item → scroll to **"Add to shopping list"** button. The label comes from the item name, the source is auto-classified:

- If the item is **expired** → `source: expired`
- Otherwise → `source: manual`

The shopping list dedupes by case-insensitive label — re-tapping won't pile up duplicates.

### Refresh suggestions (bulk)

Tap **Refresh suggestions** at the top of the shopping list. Kalta scans your inventory and appends rows for:

- Items currently expired
- Items below their **low-stock threshold** (the `min_quantity` you set on items or custom products)
- Missing entries from the **emergency kit checklist**

Existing rows aren't disturbed; only genuinely new suggestions appear. Each gets the appropriate source tag so the restock flow knows what to do with it.

## Source tags

Every shopping row carries a tiny tag showing where it came from:

| Tag | Meaning |
|---|---|
| **Manual** | You typed it in |
| **Expired** | Triggered by an item past its expiry |
| **Low stock** | Triggered by a quantity below the threshold |
| **Kit gap** | Suggested from the emergency kit checklist |

The tag matters because it determines which restock flow you get.

## The restock flow

When you tap the bag icon on a **Ready to restock** row, Kalta picks one of two paths based on how **specific** the row is.

### Specific rows (low stock / expired)

Source `low_stock` or `expired`. Kalta knows the exact product — it has a barcode or a direct link to the original inventory item — so it skips the full add-items flow and opens a **lightweight Restock sheet**:

1. **Quantity** — defaults to 1
2. **Expiry** — defaults from the underlying custom product's typical shelf life, or you pick a date
3. **Box** — pick the destination

Tap **Restock** → an inventory item is created (cloning the name, category, calories, content-per-item, barcode from the source) → the shopping row disappears.

That's it. Two inputs, one save, and the dashboard updates.

If the product you actually bought is different (e.g. you switched brands), there's a **"Different product? Open full add-items"** escape hatch at the bottom of the sheet that takes you into the scanner.

### Generic rows (gap / manual)

Source `gap` (kit checklist) or `manual` is open-ended — the row says "Food" or "Tools" without naming a specific product. Tap the bag icon and Kalta:

1. Opens a **box picker** so you choose where the new items go
2. Pushes you into **add-items** with a green banner: *"Restocking: Food · row clears on first save"*
3. As you add the actual items (scan EAN, or type manually), the first successful save deletes the original shopping row

This is the right flow when one shopping intent ("Food") maps to multiple inventory items ("rice", "canned beans", "pasta").

<div class="screenshot">[Screenshot: "Restocking: Food" banner at top of add-items]</div>

## Watching the kit checklist react

Because the readiness dashboard's kit checklist tracks the same shopping rows you're working with, you can see the loop progress in real time:

1. **Missing** kit chip (red +)
2. Tap → Add to shopping list → chip flips to **On list** (sage 🛒)
3. Check it off in the store → chip flips to **Purchased** (amber 🛍)
4. Restock into a box → inventory match found → chip flips to **Stocked** (green ✓)
5. If the inventory item later expires or gets deleted and no shopping row exists → chip drops back to **Missing**

It's the same row, just travelling through four states across the dashboard's UI.

## The notifications bell

The warehouse header bell consolidates alerts. When the shopping list has unchecked items or anything waiting to restock, the bell lights up with an amber dot — tap it to see the Shopping card without leaving the boxes view. See [Expiry & reminders](/docs/expiry-and-reminders) for the full notifications behaviour.

## Sharing

Shopping list is part of the warehouse's synced data: invite your partner ([Sharing & P2P sync](/docs/collaboration)) and they see the same list, can check items off as they shop, and the restock flow works for whoever's home first.

## What's next

- Tune the readiness numbers your shopping flow feeds into → [Readiness dashboard](/docs/readiness).
- Use [Expiry & reminders](/docs/expiry-and-reminders) so you don't have to remember to refresh suggestions yourself.
