// ============================================================================
// Kalta – AiProposal primitive (Sprint 8)
// The shared shape every AI feature returns. AI NEVER mutates data directly —
// it returns one of these proposals, the app renders it into the target form
// via AiProposalSheet, the user edits/confirms, and only then does the caller
// apply it through the normal local-first write functions.
//
//   shopping — rows to add to the shopping list (advisor, gap suggestions)
//   pins     — inventory item ↔ checklist entry matches (smart match)
//   items    — drafts to batch-add into a box (purchase import)
//   advice   — free-text guidance, no action
// ============================================================================
import { CATEGORIES, type Category } from '@/src/types/database';

export interface ProposalShoppingRow {
  label: string;
  category: Category | null;
  quantity: number | null;
  reason: string | null;
}

export interface ProposalPin {
  entryId: string;
  itemId: string;
  itemName: string;
  entryLabel: string;
  reason: string | null;
}

export interface ProposalItemDraft {
  name: string;
  category: Category | null;
  quantity: number;
  estExpiryDays: number | null;
}

export type AiProposal =
  | { kind: 'shopping'; rows: ProposalShoppingRow[] }
  | { kind: 'pins'; matches: ProposalPin[] }
  | { kind: 'items'; drafts: ProposalItemDraft[] }
  | { kind: 'advice'; text: string };

/** Number of editable line items in a proposal (0 for advice). */
export function proposalCount(p: AiProposal): number {
  switch (p.kind) {
    case 'shopping':
      return p.rows.length;
    case 'pins':
      return p.matches.length;
    case 'items':
      return p.drafts.length;
    case 'advice':
      return 0;
  }
}

/**
 * Coerce an arbitrary AI-returned category string onto our 8 domain
 * categories, or null when it doesn't match. Tolerant of casing / surrounding
 * whitespace; anything unknown falls back to null so the user picks.
 */
export function normalizeCategory(raw: unknown): Category | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const hit = (CATEGORIES as string[]).find((c) => c === v);
  return (hit as Category | undefined) ?? null;
}
