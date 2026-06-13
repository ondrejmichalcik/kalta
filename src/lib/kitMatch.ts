// ============================================================================
// Kalta – AI emergency-kit smart match (Sprint 7)
// Optional, opt-in enhancement over the local keyword/category matcher. Asks
// Claude to map inventory item names onto checklist entries that the local
// matcher left uncovered — useful for custom entries that have weak or no
// keywords ("dog food" → "Pedigree 2kg").
//
// Offline-first contract: this is NEVER called automatically. The UI only
// shows a "Smart match" button when a BYOK Anthropic key is present
// (hasAnthropicKey), and the user must explicitly confirm before the network
// call runs. The local matcher remains the always-available default.
//
// Mirrors src/lib/vision.ts: direct client call to api.anthropic.com with the
// per-device key, structured tool_use output, same subscription gate so the
// paywall copy stays consistent.
// ============================================================================
import { getAnthropicKey } from './secureStore';
import { CloudFeatureDisabledError, isCloudEnabledNow } from './subscription';
import { MissingApiKeyError } from './vision';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';
const API_VERSION = '2023-06-01';

/** Cap how many item names we send in one batch — keeps the call cheap and
 *  the prompt small. The caller is told (via the return) how many were sent. */
const MAX_ITEMS = 300;

export interface KitMatchEntry {
  id: string;
  label: string;
  rationale?: string;
}

export interface KitMatchInventoryItem {
  id: string;
  name: string;
}

export interface KitMatchSuggestion {
  entryId: string;
  itemId: string;
  itemName: string;
  entryLabel: string;
}

/**
 * Ask Claude which inventory items satisfy which checklist entries. Returns a
 * de-duplicated list of suggestions (each entry matched to at most one item).
 * Throws CloudFeatureDisabledError / MissingApiKeyError when gated, or a
 * generic Error for network / HTTP / malformed-response failures.
 */
export async function suggestKitMatches(
  entries: KitMatchEntry[],
  items: KitMatchInventoryItem[],
): Promise<KitMatchSuggestion[]> {
  if (!isCloudEnabledNow()) {
    throw new CloudFeatureDisabledError('AI smart match');
  }
  const key = await getAnthropicKey();
  if (!key) throw new MissingApiKeyError();

  if (entries.length === 0 || items.length === 0) return [];

  const batch = items.slice(0, MAX_ITEMS);
  const entryById = new Map(entries.map((e) => [e.id, e]));

  const entryList = entries
    .map((e) => `- [${e.id}] ${e.label}${e.rationale ? ` — ${e.rationale}` : ''}`)
    .join('\n');
  const itemList = batch.map((it, i) => `${i}: ${it.name}`).join('\n');

  const body = {
    model: MODEL,
    max_tokens: 1024,
    tools: [
      {
        name: 'record_matches',
        description:
          'Record which inventory item satisfies each emergency-kit checklist entry.',
        input_schema: {
          type: 'object',
          properties: {
            matches: {
              type: 'array',
              description:
                'One entry per confident match. Omit entries with no good match. Each item index and entry id must be used at most once.',
              items: {
                type: 'object',
                properties: {
                  entry_id: {
                    type: 'string',
                    description: 'The [id] of the checklist entry this item satisfies.',
                  },
                  item_index: {
                    type: 'integer',
                    description: 'The numeric index of the matching inventory item.',
                  },
                },
                required: ['entry_id', 'item_index'],
              },
            },
          },
          required: ['matches'],
        },
        cache_control: { type: 'ephemeral' },
      },
    ],
    tool_choice: { type: 'tool', name: 'record_matches' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'You match household emergency-supply inventory to a readiness checklist.\n\n' +
              'CHECKLIST ENTRIES (things the household wants to have ready):\n' +
              `${entryList}\n\n` +
              'INVENTORY ITEMS (what is actually in their boxes):\n' +
              `${itemList}\n\n` +
              'For each checklist entry, decide which inventory item (if any) clearly ' +
              'satisfies it. Only match when you are reasonably confident. An inventory ' +
              'item satisfies at most one entry, and an entry is satisfied by at most one ' +
              'item. Return matches only — skip entries with no good match.',
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
    ? data.content.find((b: any) => b?.type === 'tool_use' && b?.name === 'record_matches')
    : null;
  const matches = toolBlock?.input?.matches;
  if (!Array.isArray(matches)) return [];

  const seenEntries = new Set<string>();
  const seenItems = new Set<number>();
  const out: KitMatchSuggestion[] = [];
  for (const m of matches) {
    const entryId = typeof m?.entry_id === 'string' ? m.entry_id : null;
    const idx = typeof m?.item_index === 'number' ? m.item_index : -1;
    if (!entryId || idx < 0 || idx >= batch.length) continue;
    if (seenEntries.has(entryId) || seenItems.has(idx)) continue;
    const entry = entryById.get(entryId);
    if (!entry) continue;
    seenEntries.add(entryId);
    seenItems.add(idx);
    out.push({
      entryId,
      itemId: batch[idx].id,
      itemName: batch[idx].name,
      entryLabel: entry.label,
    });
  }
  return out;
}
