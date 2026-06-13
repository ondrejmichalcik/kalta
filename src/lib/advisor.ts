// ============================================================================
// Kalta – AI readiness advisor (Sprint 8)
// Turns the readiness numbers into action: given household composition, the
// survival-days shortfall and the missing kit items, asks Claude for a
// prioritized shopping list. Returns an AiProposal{kind:'shopping'} that the
// readiness screen reviews via AiProposalSheet and applies as source='ai' rows
// (each carrying the AI's reason as provenance).
//
// Same BYOK / gating contract as vision.ts & kitMatch.ts: opt-in only, key
// required, explicit confirm before the call.
// ============================================================================
import { getAnthropicKey } from './secureStore';
import { CloudFeatureDisabledError, isCloudEnabledNow } from './subscription';
import { MissingApiKeyError } from './vision';
import { normalizeCategory, type AiProposal, type ProposalShoppingRow } from './aiProposal';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';
const API_VERSION = '2023-06-01';

export interface ReadinessContext {
  /** Human-readable household, e.g. "2 adults, 1 toddler". */
  household: string;
  goalDays: number;
  foodDays: number | null;
  waterDays: number | null;
  uncounted: number;
  /** Labels of kit entries that are currently missing. */
  missingKit: string[];
}

/**
 * Ask Claude for a prioritized shopping list that closes the household's
 * readiness gaps. Throws CloudFeatureDisabledError / MissingApiKeyError when
 * gated, or a generic Error on network / HTTP / malformed-response failures.
 */
export async function analyzeReadiness(ctx: ReadinessContext): Promise<AiProposal> {
  if (!isCloudEnabledNow()) {
    throw new CloudFeatureDisabledError('AI readiness advisor');
  }
  const key = await getAnthropicKey();
  if (!key) throw new MissingApiKeyError();

  const food = ctx.foodDays != null ? `${Math.floor(ctx.foodDays)} days` : 'unknown';
  const water = ctx.waterDays != null ? `${Math.floor(ctx.waterDays)} days` : 'unknown';
  const missing = ctx.missingKit.length ? ctx.missingKit.join(', ') : '(none)';

  const body = {
    model: MODEL,
    max_tokens: 1024,
    tools: [
      {
        name: 'record_recommendations',
        description:
          'Record a prioritized shopping list that closes the household\'s emergency-readiness gaps.',
        input_schema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              description:
                'Prioritized items to buy (most important first). Be concrete and realistic for this household. 4-12 items.',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'Concrete product to buy, e.g. "Bottled water 6×1.5 L".' },
                  category: {
                    type: 'string',
                    enum: ['water', 'food', 'first_aid', 'light_power', 'tools_safety', 'sanitation', 'documents', 'other'],
                  },
                  quantity: { type: 'integer', description: 'How many to buy (omit or 1 if unsure).' },
                  reason: { type: 'string', description: 'One short line: why this, for this household.' },
                },
                required: ['label', 'category', 'reason'],
              },
            },
          },
          required: ['items'],
        },
        cache_control: { type: 'ephemeral' },
      },
    ],
    tool_choice: { type: 'tool', name: 'record_recommendations' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'You are an emergency-preparedness advisor for a household stocking supplies.\n\n' +
              `Household: ${ctx.household}\n` +
              `Goal: ${ctx.goalDays} days of supply.\n` +
              `Current food coverage: ${food}. Water coverage: ${water}.\n` +
              `Items not counted (missing nutrition data): ${ctx.uncounted}.\n` +
              `Missing emergency-kit items: ${missing}.\n\n` +
              'Recommend a prioritized shopping list to close the gaps. Prioritize the ' +
              'weakest area first (food/water shortfall, then missing kit). Be concrete, ' +
              'realistic in quantity for this household size, and give a one-line reason each.',
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
    ? data.content.find((b: any) => b?.type === 'tool_use' && b?.name === 'record_recommendations')
    : null;
  const items = toolBlock?.input?.items;
  if (!Array.isArray(items)) return { kind: 'shopping', rows: [] };

  const rows: ProposalShoppingRow[] = [];
  for (const it of items) {
    const label = typeof it?.label === 'string' ? it.label.trim() : '';
    if (!label) continue;
    const qty = typeof it?.quantity === 'number' && it.quantity > 0 ? Math.round(it.quantity) : null;
    rows.push({
      label,
      category: normalizeCategory(it?.category),
      quantity: qty,
      reason: typeof it?.reason === 'string' ? it.reason.trim() || null : null,
    });
  }
  return { kind: 'shopping', rows };
}
