// ============================================================================
// Kalta – Claude Vision wrapper
// Direct call to api.anthropic.com from the React Native client. Uses the
// user's per-device API key from SecureStore (see src/lib/secureStore.ts).
// No Supabase Edge Function — the key never leaves the device except in
// outbound requests to Anthropic.
//
// Structured output via tool_use: the model is forced to return a single
// `record_product` tool call, which Anthropic guarantees to be valid JSON
// matching the provided schema. The tool definition is marked with
// `cache_control: ephemeral` so the stable portion of the prompt is
// cached for 5 minutes — batch scanning a few products in quick succession
// hits the cache and costs less.
// ============================================================================
import type { Category } from '@/src/types/database';
import { getAnthropicKey } from './secureStore';
import { CloudFeatureDisabledError, isCloudEnabledNow } from './subscription';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';
const API_VERSION = '2023-06-01';

export interface IdentifiedProduct {
  name: string;
  category: Category;
  typical_shelf_life_days: number;
}

/**
 * Thrown when the user hasn't configured an API key. Callers should catch
 * this and gate the UI behind "Set up Claude Vision in Profile" instead
 * of surfacing a raw error.
 */
export class MissingApiKeyError extends Error {
  constructor() {
    super('Claude Vision not configured. Add an Anthropic API key in Profile.');
    this.name = 'MissingApiKeyError';
  }
}

/**
 * Whether the device currently has an API key stored. Cheap check (SecureStore
 * Keychain lookup) used to gate the "Identify with AI" UI.
 */
export async function hasAnthropicKey(): Promise<boolean> {
  const key = await getAnthropicKey();
  return key !== null && key.length > 0;
}

/**
 * Ask Claude to identify a product shown in the image at `imageUrl`.
 * The URL must be publicly fetchable (our `product-images` Supabase bucket
 * is public, so uploads from `uploadProductImage` work directly).
 *
 * Returns a structured product record via tool_use. Throws
 * MissingApiKeyError if no key is configured, or a generic Error for
 * network / HTTP / malformed-response failures.
 */
export async function identifyProduct(imageUrl: string): Promise<IdentifiedProduct> {
  // Gated as a subscription perk. NOTE: vision is BYOK (user provides own
  // Anthropic key), so the marginal cost to us is zero — the gate exists
  // purely to honour the paywall copy that lists AI recognition as a
  // subscription feature. If we decide BYOK should be free, drop this
  // check; the gate is the only thing separating the two interpretations.
  if (!isCloudEnabledNow()) {
    throw new CloudFeatureDisabledError('AI item recognition');
  }
  const key = await getAnthropicKey();
  if (!key) throw new MissingApiKeyError();

  const body = {
    model: MODEL,
    max_tokens: 512,
    tools: [
      {
        name: 'record_product',
        description:
          'Record the product shown in the image with its identifying details so it can be added to an inventory.',
        input_schema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description:
                'Product name as it appears on store shelves, including brand when visible. Example: "Ibuprofen 400 mg (24 tablets)" or "Heinz tomato ketchup 500 ml".',
            },
            category: {
              type: 'string',
              enum: [
                'food',
                'medicine',
                'water',
                'disinfectant',
                'equipment',
                'energy',
                'documents',
                'other',
              ],
              description: 'Best-fit category for prepper inventory tracking.',
            },
            typical_shelf_life_days: {
              type: 'integer',
              description:
                'Typical unopened shelf life in days at room temperature. Examples: canned food ~730, packaged dry goods ~365, bottled water ~730, OTC tablets ~1095, batteries ~3650.',
            },
          },
          required: ['name', 'category', 'typical_shelf_life_days'],
        },
        cache_control: { type: 'ephemeral' },
      },
    ],
    tool_choice: { type: 'tool', name: 'record_product' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'url', url: imageUrl },
          },
          {
            type: 'text',
            text: 'Identify this product from the photo. If multiple items are visible, identify the most prominent one.',
          },
        ],
      },
    ],
  };

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    throw new Error(`Network error calling Claude: ${e?.message ?? 'unknown'}`);
  }

  const data: any = await response.json().catch(() => ({}));

  if (!response.ok) {
    const msg = data?.error?.message ?? `Claude API error ${response.status}`;
    throw new Error(msg);
  }

  const toolBlock = Array.isArray(data.content)
    ? data.content.find((b: any) => b?.type === 'tool_use' && b?.name === 'record_product')
    : null;
  const input = toolBlock?.input;
  if (
    !input ||
    typeof input.name !== 'string' ||
    typeof input.category !== 'string' ||
    typeof input.typical_shelf_life_days !== 'number'
  ) {
    throw new Error('Claude did not return a valid product structure.');
  }

  return {
    name: input.name,
    category: input.category as Category,
    typical_shelf_life_days: Math.max(1, Math.round(input.typical_shelf_life_days)),
  };
}

/**
 * Format a shelf life in days as a short human hint: "2 years", "8 months",
 * "30 days". Used under the expiry picker to nudge the user toward a
 * reasonable date while still making them confirm the printed label.
 */
export function formatShelfLife(days: number): string {
  if (days >= 365) {
    const years = Math.round(days / 365);
    return years === 1 ? '1 year' : `${years} years`;
  }
  if (days >= 30) {
    const months = Math.round(days / 30);
    return months === 1 ? '1 month' : `${months} months`;
  }
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * Cheap text-only probe to verify an API key works. Used by the "Test
 * key" button on the Profile screen before saving. Returns `true` on
 * success, throws a descriptive error on failure.
 */
export async function testAnthropicKey(key: string): Promise<boolean> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': API_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'ping' }],
    }),
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message ?? `HTTP ${response.status}`);
  }
  return true;
}
