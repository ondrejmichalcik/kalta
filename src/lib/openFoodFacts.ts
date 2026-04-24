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
  };
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
  return {
    barcode,
    name: pickName(p),
    brand: p.brands?.split(',')[0]?.trim() ?? null,
    category: mapCategory(p.categories_tags),
    image_url: p.image_front_url ?? p.image_url ?? p.image_front_small_url ?? null,
    quantity: p.quantity ?? null,
  };
}
