// ============================================================================
// Kalta – Low-stock / par-level detection (Sprint 6)
// Dual storage: barcoded products keep an aggregate par level on
// custom_products.min_quantity (summed across all rows of that barcode in a
// warehouse); no-barcode items keep a per-row par level on items.min_quantity.
// Pure + UI-free.
// ============================================================================
import type { CustomProduct, Item } from '@/src/types/database';

export type StockStatus = 'low' | 'out';

/**
 * Compute low-stock status per item id for one warehouse's items.
 *  - 'out'  → product total is 0 (and a par level is configured)
 *  - 'low'  → product total is below the configured par level
 *  - absent → no par level set, or stock is at/above it
 *
 * Barcoded items: total is summed across all rows of that barcode, and every
 * row of an under-par product is flagged. No-barcode items: evaluated per row.
 */
export function computeLowStock(
  items: Item[],
  customProducts: CustomProduct[],
): Map<string, StockStatus> {
  const result = new Map<string, StockStatus>();

  // barcode → aggregate par level
  const minByBarcode = new Map<string, number>();
  for (const cp of customProducts) {
    if (cp.min_quantity != null) minByBarcode.set(cp.barcode, cp.min_quantity);
  }

  // Group barcoded items + sum quantities.
  const byBarcode = new Map<string, { rows: Item[]; total: number }>();
  for (const item of items) {
    if (!item.barcode) continue;
    const bucket = byBarcode.get(item.barcode) ?? { rows: [], total: 0 };
    bucket.rows.push(item);
    bucket.total += item.quantity;
    byBarcode.set(item.barcode, bucket);
  }

  for (const [barcode, { rows, total }] of byBarcode) {
    const min = minByBarcode.get(barcode);
    if (min == null) continue;
    const status: StockStatus | null = total <= 0 ? 'out' : total < min ? 'low' : null;
    if (status) for (const r of rows) result.set(r.id, status);
  }

  // No-barcode items — per-row par level.
  for (const item of items) {
    if (item.barcode) continue;
    if (item.min_quantity == null) continue;
    const status: StockStatus | null =
      item.quantity <= 0 ? 'out' : item.quantity < item.min_quantity ? 'low' : null;
    if (status) result.set(item.id, status);
  }

  return result;
}
