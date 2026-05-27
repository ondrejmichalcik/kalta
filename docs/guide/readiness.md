# Readiness dashboard

Tracking individual items keeps your stock fresh. The **Readiness dashboard** answers the next question: *based on what's actually in those boxes, how long can your household survive?* It turns the inventory into a single glanceable answer in days.

The dashboard lives at warehouse level — every warehouse has its own household, goal, and coverage numbers.

## What you set up first

Open a warehouse → **Settings** tab → scroll to **HOUSEHOLD**. You'll find:

1. **Household members** — one row per person you're feeding. Each member has a daily calorie target (kcal) and a daily water target (litres).
2. **Readiness goal** — how many days of supplies you're aiming for. Presets: 72 hours, 2 weeks, 1 month, 3 months. The goal drives the color coding on the coverage bars.

<div class="screenshot">[Screenshot: HOUSEHOLD section in warehouse Settings]</div>

When adding a member, **Quick preset** chips fill plausible defaults: Adult male (2500 kcal / 3 L), Adult female (2000 / 2.5), Teenager (2200 / 2.5), Child 4–8 (1400 / 1.5), Toddler (1200 / 1). You can override any number afterward — the chip lights up when current values exactly match its preset.

Without at least one household member the dashboard can't compute days. It'll show a "Set up household" prompt instead.

## Opening the dashboard

Two entry points:

- **Settings tab → READINESS → Readiness dashboard** (permanent link)
- **Header bell** (when something needs attention — see "Notifications bell" in [Expiry & reminders](/docs/expiry-and-reminders))

## What the dashboard shows

### Headline (weakest link)

Big number at the top: **the lower of food days or water days**, colored against your goal:

- **Red** — less than 25% of the goal
- **Amber** — 25–99% of the goal
- **Green** — at or above the goal

The label below tells you whether food or water is the limiter, so you know which to top up.

### Coverage bars (Food / Water)

Two horizontal bars, one per category. Each bar shows current days vs the goal:

- The numeric badge on the right is the actual days you've got
- The bar fill shows progress toward the goal (capped at 100%)
- Both use the same red/amber/green tones as the headline

### Uncounted items hint

Below the bars: *"X items are not counted — add calories / weight so they count toward readiness."* This appears when food/water items don't have enough metadata for the math. Two fields drive readiness:

- **Calories per 100 g** (food only)
- **Content per item** (in grams for food, ml for water)

When an EAN scan auto-fills those fields, the item counts. Manual items default to "uncounted" unless you fill them in — see [Scanning and AI](/docs/scanning-and-ai) for the fast path.

### Emergency kit checklist

Below the coverage bars is the **EMERGENCY KIT** — a curated FEMA-style 24-item list grouped by category (Water, Food, First aid, Light & power, Tools & safety, Sanitation, Documents). Each chip has one of four lifecycle states:

| State | Color | Icon | Meaning |
|---|---|---|---|
| **Stocked** | Green | ✓ | Matched by a non-expired inventory item |
| **Purchased** | Amber | 🛍 | Checked off on the shopping list, waiting to be added to inventory |
| **On list** | Sage | 🛒 | Added to the shopping list, not yet bought |
| **Missing** | Red | + | Neither in inventory nor on the shopping list |

Tap any chip to interact with it:

- **Missing** → "Add to shopping list" or "I already have this" (manual override to stocked)
- **On list / Purchased** → "Open shopping list" or "I already have this"
- **Stocked** → shows which inventory item matched. If the match looks wrong ("Pasta De Cecco" matching ID copies?), tap "That's not really X" to mark the kit entry as missing despite the match.

The progress count at the top of the section (e.g. `12/24`) only counts **truly stocked** entries — purchased and on-list count as in-flight, not done.

### Water filter shortcut

If your inventory contains a **water filter** (keywords: LifeStraw, Sawyer, Katadyn, Berkey, Aquatabs, "water filter", "vodní filtr", …), the water coverage bar gets a **green "Filter" badge** and stops being a weakest-link candidate. The reasoning: with a filter you can extend your water supply from any nearby source, so stored litres are no longer the bottleneck.

### Daily needs link

Bottom of the dashboard: a "Manage" link back into Settings → HOUSEHOLD. Useful when you realize you need to adjust the kcal/water targets after seeing the math.

## How the math works

For each non-expired food/water item:

```
itemContent (g or ml) = quantity × net_weight_g
food kcal contribution = (energy_kcal_per_100g / 100) × itemContent
water ml contribution  = itemContent
```

Summed across the warehouse and divided by the household's total daily need:

```
foodDays  = totalKcal / totalDailyKcal
waterDays = totalLitres / totalDailyWaterL
```

Items without the required fields are excluded from the totals but counted as **uncounted**. Damaged items and expired items are also excluded.

## Keyword matching for the kit checklist

The 24 kit items match inventory by name keyword. The matcher uses **word boundaries** (so `id` matches "ID copies" but not "First aid") and supports a `*` suffix for stems (`'lék*'` matches "lék", "léky", "lékárna"). Some false positives are unavoidable when product names happen to contain a kit keyword — use the **"That's not really X"** override to correct them.

The reverse — false negatives where the matcher should have caught something — can be fixed with **"I already have this"** which forces the entry to stocked.

## Why a separate "readiness" view

The boxes list answers "what's where?". The readiness dashboard answers "**am I prepared?**". They serve different questions, both useful. The dashboard never modifies your inventory — it only reads it and tells you what the totals mean for your specific household.

## What's next

- See how purchases flow back into the dashboard in [Shopping list & restock](/docs/shopping-and-restock).
- Set up [local notifications](/docs/expiry-and-reminders) so you're warned before food drops below your goal.
