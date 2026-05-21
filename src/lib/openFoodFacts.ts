// ============================================================================
// Open Food Facts – EAN lookup
// Docs: https://world.openfoodfacts.org/data
// Free, ~3M products, ~85% hit rate for EU groceries.
// ============================================================================
import type { Category } from '@/src/types/database';

export interface OpenFoodFactsProduct {
  barcode: string;
  name: string;
  brand: string | null;
  category: Category | null;
  image_url: string | null;
  quantity: string | null; // "500 g", "1 l" — raw text from OFF
  // Sprint 6 — readiness nutrition
  energy_kcal_per_100g: number | null;
  net_weight_g: number | null; // parsed from quantity / product_quantity
}

interface OffApiResponse {
  status: 0 | 1;
  status_verbose?: string;
  code?: string;
  product?: {
    product_name?: string;
    product_name_cs?: string;
    generic_name?: string;
    brands?: string;
    categories_tags?: string[];
    image_url?: string;
    image_front_url?: string;
    image_front_small_url?: string;
    quantity?: string;
    product_quantity?: string | number;
    nutriments?: Record<string, number | string | undefined>;
  };
}

/**
 * Parse a free-text net-content string into grams (≈ ml for liquids,
 * since water density ≈ 1 g/ml — readiness treats net_weight_g as ml for
 * water items). Handles multipliers ("6 x 1.5 l"), comma decimals, and
 * g/kg/mg/ml/cl/l units. Returns null if it can't make sense of it.
 */
export function parseNetWeightGrams(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(',', '.').trim();
  // Optional "N x" / "N×" multiplier (a 6-pack, etc.)
  const multMatch = s.match(/^(\d+(?:\.\d+)?)\s*[x×]\s*(.+)$/);
  const multiplier = multMatch ? parseFloat(multMatch[1]) : 1;
  const rest = multMatch ? multMatch[2] : s;
  const m = rest.match(/(\d+(?:\.\d+)?)\s*(kg|mg|cl|ml|g|l)\b/);
  if (!m) return null;
  const value = parseFloat(m[1]);
  if (!Number.isFinite(value)) return null;
  const unit = m[2];
  const toGrams: Record<string, number> = {
    g: 1, kg: 1000, mg: 0.001, ml: 1, cl: 10, l: 1000,
  };
  const grams = value * (toGrams[unit] ?? 1) * multiplier;
  return Number.isFinite(grams) && grams > 0 ? Math.round(grams) : null;
}

/** Extract kcal per 100g from OFF nutriments, falling back to kJ. */
function extractKcalPer100g(
  nutriments: Record<string, number | string | undefined> | undefined,
): number | null {
  if (!nutriments) return null;
  const kcal = Number(nutriments['energy-kcal_100g']);
  if (Number.isFinite(kcal) && kcal > 0) return Math.round(kcal);
  const kj = Number(nutriments['energy-kj_100g'] ?? nutriments['energy_100g']);
  if (Number.isFinite(kj) && kj > 0) return Math.round(kj / 4.184);
  return null;
}

/**
 * Heuristic mapping of OFF category tags to our domain categories.
 * OFF category tag has the form "en:dairy", "cs:nápoje", etc.
 */
function mapCategory(tags: string[] | undefined): Category | null {
  if (!tags || tags.length === 0) return null;
  const joined = tags.join(' ').toLowerCase();

  // Medicine / drugstore
  if (/medicine|pharmac|drug|medicament|lék|vitamin/.test(joined)) return 'medicine';

  // Water
  if (/mineral-water|spring-water|drinking-water|water\b|voda/.test(joined)) return 'water';

  // Disinfectant / hygiene
  if (/disinfect|sanit|hygien|dezinf|cleaner|soap|mýdlo/.test(joined)) return 'disinfectant';

  // Energy / batteries
  if (/battery|baterie|energy-drink/.test(joined)) return 'energy';

  // Anything else food-related
  if (/food|beverage|dairy|meat|fish|vegetable|fruit|cereal|snack|bread|cheese|pasta|drink|juice|coffee|tea|potraviny|nápoj|pečivo|mléko|maso/.test(joined))
    return 'food';

  return null;
}

/**
 * Picks the best product name — prefers Czech, then English, then generic.
 */
function pickName(p: NonNullable<OffApiResponse['product']>): string {
  const candidates = [p.product_name_cs, p.product_name, p.generic_name]
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  return candidates[0]?.trim() ?? 'Unknown product';
}

/**
 * Lookup a product by EAN/UPC code.
 * - Returns `null` if the product isn't in OFF (status=0).
 * - Throws only on network failure.
 */
export async function lookupByBarcode(barcode: string): Promise<OpenFoodFactsProduct | null> {
  const url = `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(barcode)}.json`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        // OFF asks clients to identify themselves
        'User-Agent': 'Kalta/1.0 (https://github.com/ondrejmichalcik/kalta)',
      },
    });
  } catch (e) {
    throw new Error('Cannot connect to Open Food Facts.');
  }

  if (!response.ok) {
    throw new Error(`Open Food Facts: HTTP ${response.status}`);
  }

  const json = (await response.json()) as OffApiResponse;
  if (json.status !== 1 || !json.product) return null;

  const p = json.product;
  // Prefer the structured product_quantity (numeric grams) if present,
  // else parse the free-text quantity string.
  const netFromStructured =
    p.product_quantity != null && Number.isFinite(Number(p.product_quantity))
      ? Math.round(Number(p.product_quantity))
      : null;
  return {
    barcode,
    name: pickName(p),
    brand: p.brands?.split(',')[0]?.trim() ?? null,
    category: mapCategory(p.categories_tags),
    image_url: p.image_front_url ?? p.image_url ?? p.image_front_small_url ?? null,
    quantity: p.quantity ?? null,
    energy_kcal_per_100g: extractKcalPer100g(p.nutriments),
    net_weight_g: netFromStructured ?? parseNetWeightGrams(p.quantity),
  };
}
