// ============================================================================
// Kalta – Custom checklist helpers (Sprint 7)
// Bridges the DB-backed checklist rows to the shared coverage matcher:
//   • entryToKitItem      — ChecklistEntry → KitItem (matcher input shape)
//   • satisfactionsToMaps — satisfaction rows → { overrides, pins } maps
//   • ensureSeededChecklists — seed the FEMA kit into a warehouse on first use,
//     migrating any legacy AsyncStorage dismiss overrides into the DB so the
//     couple's existing per-warehouse tweaks survive the move.
// ============================================================================
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DAILY_NEED_PRESETS } from '@/src/types/database';
import type {
  Checklist,
  ChecklistEntry,
  ChecklistSatisfaction,
  HouseholdMember,
  MemberKind,
} from '@/src/types/database';
import type { KitAddon, KitItem } from '@/src/data/emergencyKit';
import { EMERGENCY_KIT, KIT_ADDONS } from '@/src/data/emergencyKit';
import type { KitOverride } from '@/src/lib/kitCoverage';
import * as Crypto from 'expo-crypto';
import {
  addWarehouseChecklist,
  createChecklist,
  createChecklistEntry,
  deleteChecklist,
  listChecklistEntries,
  listChecklists,
  listWarehouseChecklists,
  setChecklistSatisfaction,
} from '@/src/lib/supabase';

// Deterministic UUID (v5-style) from a seed string, so the FEMA seed checklist
// and its entries get the SAME id on every device. Two members opening a fresh
// warehouse then produce identical rows that the sync layer collapses, instead
// of two separate "Emergency kit (FEMA)" lists.
async function deterministicId(seed: string): Promise<string> {
  const hex = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `kalta:checklist:${seed}`,
  );
  const h = hex.slice(0, 32);
  const version = `5${h.slice(13, 16)}`; // version nibble = 5
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16); // 8/9/a/b
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${version}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const legacyDismissKey = (warehouseId: string) => `@kalta/kit_dismissed_${warehouseId}`;

/** Map a DB checklist entry into the KitItem shape the matcher consumes. The
 *  entry's own id is the matcher key (satisfactions/pins are keyed by it). */
export function entryToKitItem(e: ChecklistEntry): KitItem {
  return {
    id: e.id,
    label: e.label,
    group: e.group_name ?? 'Other',
    category: e.category,
    keywords: e.keywords,
    rationale: e.rationale ?? '',
    quantified: e.quantified ?? undefined,
  };
}

/** Split satisfaction rows into the override map and pin map the matcher takes.
 *  Pins (mode='pin') carry an item_id; the three overrides do not. */
export function satisfactionsToMaps(sats: ChecklistSatisfaction[]): {
  overrides: Map<string, KitOverride>;
  pins: Map<string, string>;
} {
  const overrides = new Map<string, KitOverride>();
  const pins = new Map<string, string>();
  for (const s of sats) {
    if (s.mode === 'pin') {
      if (s.item_id) pins.set(s.checklist_entry_id, s.item_id);
    } else {
      overrides.set(s.checklist_entry_id, s.mode);
    }
  }
  return { overrides, pins };
}

/** Read the legacy AsyncStorage dismiss map for a warehouse. Supports both the
 *  old `string[]` (all force_stocked) and the newer `{ id: override }` format. */
async function readLegacyOverrides(warehouseId: string): Promise<Map<string, KitOverride>> {
  const out = new Map<string, KitOverride>();
  try {
    const raw = await AsyncStorage.getItem(legacyDismissKey(warehouseId));
    if (!raw) return out;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const id of parsed) if (typeof id === 'string') out.set(id, 'force_stocked');
    } else if (parsed && typeof parsed === 'object') {
      for (const [id, mode] of Object.entries(parsed)) {
        if (mode === 'force_stocked' || mode === 'force_missing' || mode === 'not_applicable') {
          out.set(id, mode);
        }
      }
    }
  } catch {
    /* ignore corrupt */
  }
  return out;
}

/**
 * Clone the FEMA kit into a warehouse as a seed checklist and link it. Migrates
 * any legacy AsyncStorage overrides (keyed by hardcoded kit.id → entry.seed_key)
 * into DB satisfactions. Returns the created seed checklist.
 */
export async function seedFemaChecklist(warehouseId: string): Promise<Checklist> {
  const checklistId = await deterministicId(`${warehouseId}:fema`);
  const checklist = await createChecklist({
    id: checklistId,
    warehouse_id: warehouseId,
    name: 'Emergency kit (FEMA)',
    is_seed: true,
    goal_days: null,
  });

  const seedKeyToEntryId = new Map<string, string>();
  for (let i = 0; i < EMERGENCY_KIT.length; i++) {
    const k = EMERGENCY_KIT[i];
    const entryId = await deterministicId(`${warehouseId}:fema:${k.id}`);
    const entry = await createChecklistEntry({
      id: entryId,
      checklist_id: checklist.id,
      warehouse_id: warehouseId,
      seed_key: k.id,
      label: k.label,
      group_name: k.group,
      category: k.category,
      keywords: k.keywords,
      quantified: k.quantified ?? null,
      rationale: k.rationale,
      sort_order: i,
    });
    seedKeyToEntryId.set(k.id, entry.id);
  }

  await addWarehouseChecklist({ warehouse_id: warehouseId, checklist_id: checklist.id });

  // Migrate legacy per-warehouse overrides onto the freshly seeded entries.
  const legacy = await readLegacyOverrides(warehouseId);
  for (const [seedKey, mode] of legacy) {
    const entryId = seedKeyToEntryId.get(seedKey);
    if (!entryId) continue;
    try {
      await setChecklistSatisfaction({
        checklist_entry_id: entryId,
        warehouse_id: warehouseId,
        mode,
      });
    } catch {
      /* best-effort migration */
    }
  }
  // Migration done — drop the legacy AsyncStorage key so it can't be re-applied
  // and doesn't linger as dead data.
  await AsyncStorage.removeItem(legacyDismissKey(warehouseId)).catch(() => {});

  return checklist;
}

// Dedupe concurrent first-load seeds: several screens (readiness / checklists /
// shopping) call ensureSeededChecklists on focus, and their awaits interleave
// before the first INSERT lands — without this they'd each seed a FEMA list.
// Keyed per warehouse; cleared when the seed settles. (In-process only; a
// cross-device first-open race is out of scope and self-heals via LWW dedup.)
const seedingInFlight = new Map<string, Promise<Checklist[]>>();

/**
 * Ensure a warehouse has at least the FEMA seed checklist. Returns all of the
 * warehouse's checklists (seeding first if there were none).
 */
export async function ensureSeededChecklists(warehouseId: string): Promise<Checklist[]> {
  let existing = await listChecklists(warehouseId);

  // Collapse duplicate FEMA seeds — created before the deterministic-id fix by
  // a cross-device first-open race (each member's device seeded its own). Keep
  // the oldest, delete the rest; the deletion syncs so both devices converge.
  const seeds = existing.filter((c) => c.is_seed);
  if (seeds.length > 1) {
    const sorted = [...seeds].sort((a, b) =>
      (a.created_at ?? '').localeCompare(b.created_at ?? ''),
    );
    for (const dup of sorted.slice(1)) {
      try {
        await deleteChecklist(dup.id);
      } catch {
        /* best-effort dedup */
      }
    }
    existing = await listChecklists(warehouseId);
  }

  if (existing.length > 0) return existing;

  const inflight = seedingInFlight.get(warehouseId);
  if (inflight) return inflight;

  const promise = (async () => {
    // Re-check after winning the slot — another caller may have just seeded.
    const recheck = await listChecklists(warehouseId);
    if (recheck.length > 0) return recheck;
    await seedFemaChecklist(warehouseId);
    return listChecklists(warehouseId);
  })().finally(() => seedingInFlight.delete(warehouseId));

  seedingInFlight.set(warehouseId, promise);
  return promise;
}

/**
 * Create a new checklist by copying all entries from an existing one (e.g.
 * "start from FEMA basic"). The copy is a normal editable checklist (is_seed
 * stays false), so it can be renamed and deleted.
 */
export async function cloneChecklist(
  warehouseId: string,
  sourceChecklistId: string,
  name: string,
): Promise<Checklist> {
  const checklist = await createChecklist({ warehouse_id: warehouseId, name });
  const entries = await listChecklistEntries(sourceChecklistId);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    await createChecklistEntry({
      checklist_id: checklist.id,
      warehouse_id: warehouseId,
      seed_key: e.seed_key,
      label: e.label,
      group_name: e.group_name,
      category: e.category,
      keywords: e.keywords,
      quantified: e.quantified,
      rationale: e.rationale,
      sort_order: e.sort_order ?? i,
    });
  }
  return checklist;
}

/**
 * Add-on packs suggested by the household composition (e.g. an adult_female →
 * feminine hygiene, an infant/toddler → baby supplies) that aren't already
 * fully present in the seed checklist's entries.
 */
/** A member's kind — stored, or derived from its needs matching a preset
 *  (so members added before the `kind` column still drive suggestions). */
function memberKind(m: HouseholdMember): MemberKind | null {
  if (m.kind) return m.kind;
  const p = DAILY_NEED_PRESETS.find(
    (x) => x.daily_kcal === m.daily_kcal && x.daily_water_l === m.daily_water_l,
  );
  return p?.kind ?? null;
}

export function suggestedAddons(
  members: HouseholdMember[],
  seedEntries: ChecklistEntry[],
): KitAddon[] {
  const kinds = new Set(members.map(memberKind).filter(Boolean) as string[]);
  const presentSeedKeys = new Set(
    seedEntries.map((e) => e.seed_key).filter(Boolean) as string[],
  );
  return KIT_ADDONS.filter(
    (a) =>
      a.triggerKinds.some((k) => kinds.has(k)) &&
      a.entries.some((e) => !presentSeedKeys.has(e.id)),
  );
}

/** Insert an add-on pack's entries into a checklist (skipping any already there). */
export async function addAddonToChecklist(
  warehouseId: string,
  checklistId: string,
  addon: KitAddon,
): Promise<void> {
  const existing = await listChecklistEntries(checklistId);
  const present = new Set(existing.map((e) => e.seed_key).filter(Boolean) as string[]);
  let order = existing.length;
  for (const e of addon.entries) {
    if (present.has(e.id)) continue;
    await createChecklistEntry({
      checklist_id: checklistId,
      warehouse_id: warehouseId,
      seed_key: e.id,
      label: e.label,
      group_name: e.group,
      category: e.category,
      keywords: e.keywords,
      quantified: e.quantified ?? null,
      rationale: e.rationale,
      sort_order: order++,
    });
  }
}

/**
 * Resolve the warehouse's active checklists (linked ones, or all when nothing
 * is linked) — same rule the readiness / shopping screens use.
 */
async function activeChecklistIds(warehouseId: string, checklists: Checklist[]): Promise<string[]> {
  const links = await listWarehouseChecklists(warehouseId).catch(() => []);
  const linkedIds = new Set(links.map((l) => l.checklist_id));
  return checklists
    .filter((c) => linkedIds.size === 0 || linkedIds.has(c.id))
    .map((c) => c.id);
}

/**
 * Does this warehouse track survival supplies? True when an active checklist
 * has a quantified (food/water) entry — i.e. the readiness days-of-supply card
 * is meaningful here. A warehouse whose active lists are non-food (e.g. a
 * "workshop" kit) returns false so the card can hide. Defaults to true when no
 * checklists exist yet (not configured → don't hide unexpectedly).
 */
export async function warehouseTracksSupplies(warehouseId: string): Promise<boolean> {
  const checklists = await listChecklists(warehouseId);
  if (checklists.length === 0) return true;
  const activeIds = await activeChecklistIds(warehouseId, checklists);
  const entryLists = await Promise.all(activeIds.map((id) => listChecklistEntries(id)));
  return entryLists.flat().some((e) => e.quantified != null);
}
