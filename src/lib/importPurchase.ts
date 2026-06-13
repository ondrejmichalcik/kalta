// ============================================================================
// Kalta – AI purchase import (Sprint 8)
// Extract a list of bought items from a receipt photo, an online-order
// screenshot, pasted order text, or a PDF invoice. One format-agnostic call
// returns an AiProposal{kind:'items'}; the screen reviews it via
// AiProposalSheet and batch-adds the confirmed drafts into a box.
//
// Online orders (Rohlík/Košík/Tesco) carry cleaner product names than paper
// receipts, so the text / screenshot paths are the most accurate.
//
// Same BYOK / gating contract as vision.ts: opt-in, key required, explicit
// confirm before the call.
// ============================================================================
import { getAnthropicKey } from './secureStore';
import { CloudFeatureDisabledError, isCloudEnabledNow } from './subscription';
import { MissingApiKeyError } from './vision';
import { normalizeCategory, type AiProposal, type ProposalItemDraft } from './aiProposal';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';
const API_VERSION = '2023-06-01';

export type PurchaseInput =
  | { type: 'image'; url: string } // publicly-fetchable image URL (uploaded screenshot/photo)
  | { type: 'pdf'; base64: string } // base64-encoded PDF invoice
  | { type: 'text'; text: string }; // pasted order / receipt text

function contentBlock(input: PurchaseInput): any {
  switch (input.type) {
    case 'image':
      return { type: 'image', source: { type: 'url', url: input.url } };
    case 'pdf':
      return {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: input.base64 },
      };
    case 'text':
      return { type: 'text', text: `ORDER / RECEIPT TEXT:\n${input.text}` };
  }
}

/**
 * Extract grocery / supply items from a purchase in any supported format.
 * Throws CloudFeatureDisabledError / MissingApiKeyError when gated, or a
 * generic Error on network / HTTP / malformed-response failures.
 */
export async function extractPurchase(input: PurchaseInput): Promise<AiProposal> {
  if (!isCloudEnabledNow()) {
    throw new CloudFeatureDisabledError('AI purchase import');
  }
  const key = await getAnthropicKey();
  if (!key) throw new MissingApiKeyError();

  const body = {
    model: MODEL,
    max_tokens: 2048,
    tools: [
      {
        name: 'record_purchase',
        description:
          'Record the buy-able supply items found in a receipt or order. Skip non-product lines (totals, tax, delivery fee, store name, loyalty points).',
        input_schema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              description: 'One entry per purchased product.',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Product name as printed, cleaned up.' },
                  category: {
                    type: 'string',
                    enum: ['water', 'food', 'first_aid', 'light_power', 'tools_safety', 'sanitation', 'documents', 'other'],
                  },
                  quantity: { type: 'integer', description: 'Units bought (default 1).' },
                  est_expiry_days: {
                    type: 'integer',
                    description: 'Rough unopened shelf life in days, or 0 if not applicable / unknown.',
                  },
                },
                required: ['name', 'category'],
              },
            },
          },
          required: ['items'],
        },
        cache_control: { type: 'ephemeral' },
      },
    ],
    tool_choice: { type: 'tool', name: 'record_purchase' },
    messages: [
      {
        role: 'user',
        content: [
          contentBlock(input),
          {
            type: 'text',
            text:
              'Extract every buy-able supply/grocery item from this purchase. Skip totals, ' +
              'tax, delivery fees, discounts, store names and loyalty lines. Clean up ' +
              'abbreviated names into readable product names. Czech receipts/orders are ' +
              'common — keep Czech product names as-is.',
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
    throw new Error(data?.error?.message ?? `Claude API error ${response.status}`);
  }

  const toolBlock = Array.isArray(data.content)
    ? data.content.find((b: any) => b?.type === 'tool_use' && b?.name === 'record_purchase')
    : null;
  const items = toolBlock?.input?.items;
  if (!Array.isArray(items)) return { kind: 'items', drafts: [] };

  const drafts: ProposalItemDraft[] = [];
  for (const it of items) {
    const name = typeof it?.name === 'string' ? it.name.trim() : '';
    if (!name) continue;
    const qty = typeof it?.quantity === 'number' && it.quantity > 0 ? Math.round(it.quantity) : 1;
    const days =
      typeof it?.est_expiry_days === 'number' && it.est_expiry_days > 0
        ? Math.round(it.est_expiry_days)
        : null;
    drafts.push({ name, category: normalizeCategory(it?.category), quantity: qty, estExpiryDays: days });
  }
  return { kind: 'items', drafts };
}
