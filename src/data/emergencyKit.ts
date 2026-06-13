// ============================================================================
// Kalta – Emergency kit checklist (Sprint 6, coverage gaps)
// Curated set based on FEMA Ready.gov "Build A Kit". Each entry is matched
// against inventory item names by keyword (EN + CZ) — fuzzy by design, false
// negatives are handled by local manual dismiss. `category` is used when a
// gap is pushed to the shopping list.
// ============================================================================
import type { Category, MemberKind } from '@/src/types/database';

export interface KitItem {
  id: string;
  label: string;
  group: string;
  category: Category | null;
  keywords: string[];
  rationale: string;
  /**
   * When set, the entry's coverage is driven by the readiness days engine for
   * that category rather than a binary have/don't-have keyword match. Lets the
   * checklist show "4 of 14 days" instead of a misleading ✓ on a single bottle.
   */
  quantified?: 'food' | 'water';
}

export const EMERGENCY_KIT: KitItem[] = [
  // --- Water -----------------------------------------------------------------
  {
    id: 'water',
    label: 'Drinking water',
    group: 'Water',
    category: 'water',
    keywords: ['water', 'voda', 'mineral'],
    rationale: 'At least 3 litres per person per day for several days.',
    quantified: 'water',
  },

  {
    id: 'water-filter',
    label: 'Water filter',
    group: 'Water',
    category: 'tools_safety',
    keywords: [
      'water filter',
      'vodní filtr',
      'filtr na vodu',
      'lifestraw',
      'sawyer',
      'katadyn',
      'berkey',
      'aquatabs',
    ],
    rationale:
      'A filter (or purification tablets) lets you extend your water supply from any nearby source.',
  },

  // --- Food ------------------------------------------------------------------
  {
    id: 'food',
    label: 'Non-perishable food',
    group: 'Food',
    category: 'food',
    keywords: ['food', 'jídlo', 'konzerv*', 'canned', 'rice', 'rýže', 'pasta', 'těstovin*', 'beans', 'luštěnin*'],
    rationale: 'Several days of shelf-stable food that needs no cooking.',
    quantified: 'food',
  },
  {
    id: 'can-opener',
    label: 'Manual can opener',
    group: 'Food',
    category: 'tools_safety',
    keywords: ['opener*', 'otvírák*'],
    rationale: 'Canned food is useless without a way to open it.',
  },
  {
    id: 'stove',
    label: 'Camping stove & fuel',
    group: 'Food',
    category: 'tools_safety',
    keywords: ['camping stove', 'stove*', 'vařič*', 'kartuš*', 'butan*', 'propan*', 'gas canister'],
    rationale: 'A way to cook or boil water when the power is out.',
  },

  // --- First aid & medicine --------------------------------------------------
  {
    id: 'first-aid',
    label: 'First aid kit',
    group: 'First aid',
    category: 'first_aid',
    keywords: ['first aid', 'lékárnič*', 'obvaz*', 'bandage*', 'plaster*', 'náplast*'],
    rationale: 'Bandages, antiseptic, gauze for treating injuries.',
  },
  {
    id: 'medications',
    label: 'Prescription medication',
    group: 'First aid',
    category: 'first_aid',
    keywords: ['medicine*', 'lék*', 'prescription*', 'předpis*'],
    rationale: 'A 7-day supply of any regular medication.',
  },
  {
    id: 'pain-relievers',
    label: 'Pain relievers',
    group: 'First aid',
    category: 'first_aid',
    keywords: ['ibuprofen*', 'paracetamol*', 'painkiller*', 'aspirin*', 'analget*', 'bolest*'],
    rationale: 'Over-the-counter pain and fever relief.',
  },

  // --- Light & power ---------------------------------------------------------
  {
    id: 'flashlight',
    label: 'Flashlight',
    group: 'Light & power',
    category: 'light_power',
    keywords: ['flashlight*', 'baterk*', 'čelovk*', 'headlamp*', 'svítiln*'],
    rationale: 'Hands-free light during a power outage.',
  },
  {
    id: 'batteries',
    label: 'Spare batteries',
    group: 'Light & power',
    category: 'light_power',
    keywords: ['batter*', 'bateri*', 'tužkov*', 'monočlán*'],
    rationale: 'Power for flashlights and radio.',
  },
  {
    id: 'power-bank',
    label: 'Power bank',
    group: 'Light & power',
    category: 'light_power',
    keywords: ['power bank', 'powerbank*', 'nabíječk*', 'charger*'],
    rationale: 'Keep a phone alive when the grid is down.',
  },
  {
    id: 'candles',
    label: 'Candles & matches',
    group: 'Light & power',
    category: 'light_power',
    keywords: ['candle*', 'svíčk*', 'matches', 'match', 'zápalk*', 'sirk*'],
    rationale: 'Backup light and a way to start a fire.',
  },
  {
    id: 'radio',
    label: 'Battery / hand-crank radio',
    group: 'Light & power',
    category: 'light_power',
    keywords: ['radio', 'rádio'],
    rationale: 'Receive emergency broadcasts without internet.',
  },

  // --- Warmth & shelter ------------------------------------------------------
  {
    id: 'warmth',
    label: 'Blankets & warm layers',
    group: 'Warmth & shelter',
    category: 'tools_safety',
    keywords: [
      'blanket*',
      'dek*',
      'spacák*',
      'sleeping bag',
      'izofóli*',
      'termofóli*',
      'emergency blanket',
    ],
    rationale: 'Stay warm if heating fails — critical in winter.',
  },

  // --- Tools & safety --------------------------------------------------------
  {
    id: 'multitool',
    label: 'Multi-tool or knife',
    group: 'Tools & safety',
    category: 'tools_safety',
    keywords: ['multitool*', 'multi-tool', 'knife', 'knives', 'nůž', 'nože', 'tool', 'tools', 'nářadí'],
    rationale: 'General-purpose cutting and repair.',
  },
  {
    id: 'whistle',
    label: 'Whistle',
    group: 'Tools & safety',
    category: 'tools_safety',
    keywords: ['whistle*', 'píšťalk*'],
    rationale: 'Signal for help without shouting.',
  },
  {
    id: 'masks',
    label: 'Face masks',
    group: 'Tools & safety',
    category: 'tools_safety',
    keywords: ['mask*', 'respirátor*', 'respirator*', 'ffp', 'roušk*'],
    rationale: 'Filter dust, smoke, and airborne contaminants.',
  },
  {
    id: 'duct-tape',
    label: 'Duct tape',
    group: 'Tools & safety',
    category: 'tools_safety',
    keywords: ['duct tape', 'tape', 'pásk*', 'lepicí'],
    rationale: 'Seal, repair, and improvise.',
  },
  {
    id: 'gloves',
    label: 'Work gloves',
    group: 'Tools & safety',
    category: 'tools_safety',
    keywords: ['glove*', 'rukavic*'],
    rationale: 'Protect hands during cleanup.',
  },
  {
    id: 'fire-extinguisher',
    label: 'Fire extinguisher',
    group: 'Tools & safety',
    category: 'tools_safety',
    keywords: ['extinguisher*', 'hasic*', 'hasící', 'hasící přístroj'],
    rationale: 'Put out small fires before they spread.',
  },

  // --- Sanitation ------------------------------------------------------------
  {
    id: 'sanitizer',
    label: 'Hand sanitizer',
    group: 'Sanitation',
    category: 'sanitation',
    keywords: ['sanitizer*', 'dezinfekc*', 'disinfect*'],
    rationale: 'Hygiene when running water is unavailable.',
  },
  {
    id: 'soap',
    label: 'Soap',
    group: 'Sanitation',
    category: 'sanitation',
    keywords: ['soap*', 'mýdl*'],
    rationale: 'Basic hygiene to prevent illness.',
  },
  {
    id: 'dental',
    label: 'Toothbrush & toothpaste',
    group: 'Sanitation',
    category: 'sanitation',
    keywords: ['toothbrush*', 'toothpaste*', 'zubní past*', 'zubní kartáč*', 'kartáček na zuby', 'pasta na zuby'],
    rationale: 'Oral hygiene — infections are harder to treat in an emergency.',
  },
  {
    id: 'wipes',
    label: 'Wet wipes',
    group: 'Sanitation',
    category: 'sanitation',
    keywords: ['wipe*', 'ubrousk*', 'towelette*', 'vlhčen*'],
    rationale: 'Cleaning without water.',
  },
  {
    id: 'garbage-bags',
    label: 'Garbage bags',
    group: 'Sanitation',
    category: 'sanitation',
    keywords: ['garbage', 'pytel', 'pytl*', 'sáček', 'sáčk*', 'odpad*', 'trash bag'],
    rationale: 'Waste containment and sanitation.',
  },
  {
    id: 'toilet-paper',
    label: 'Toilet paper',
    group: 'Sanitation',
    category: 'sanitation',
    keywords: ['toilet paper', 'toaletní papír', 'toaletní', 'toaleťák*'],
    rationale: 'Basic sanitation that runs out fast.',
  },

  // --- Documents & money -----------------------------------------------------
  {
    id: 'id-copies',
    label: 'ID & insurance copies',
    group: 'Documents',
    category: 'documents',
    keywords: ['id', 'doklad*', 'pojištění', 'insurance', 'passport*', 'pas', 'občank*'],
    rationale: 'Copies of key documents in a waterproof bag.',
  },
  {
    id: 'cash',
    label: 'Emergency cash',
    group: 'Documents',
    category: 'documents',
    keywords: ['cash', 'hotovost', 'peníze', 'money'],
    rationale: 'Card terminals fail during outages.',
  },
  {
    id: 'contacts',
    label: 'Emergency contacts',
    group: 'Documents',
    category: 'documents',
    keywords: ['contact*', 'kontakt*', 'telefon*'],
    rationale: 'A written list in case your phone dies.',
  },
];

// ============================================================================
// Household-aware add-on packs (Sprint 7+). Suggested for the warehouse's seed
// checklist when the household composition implies them — e.g. an adult female
// → feminine hygiene, an infant/toddler → baby supplies. Each entry's `id`
// becomes its `seed_key` so the pack can be detected / removed later.
// ============================================================================
export interface KitAddon {
  key: string;
  label: string;
  /** Member kinds whose presence suggests this pack. */
  triggerKinds: MemberKind[];
  entries: KitItem[];
}

// FEMA groups exposed as reusable packs (built from EMERGENCY_KIT so there's
// no duplicated data). Lets a custom checklist pull in whole prepared groups
// like "First aid" or "Light & power" instead of adding items one by one.
const FEMA_GROUP_PACKS: KitAddon[] = (() => {
  const order: string[] = [];
  const byGroup = new Map<string, KitItem[]>();
  for (const item of EMERGENCY_KIT) {
    if (!byGroup.has(item.group)) {
      byGroup.set(item.group, []);
      order.push(item.group);
    }
    byGroup.get(item.group)!.push(item);
  }
  return order.map((g) => ({
    key: `fema:${g}`,
    label: g,
    triggerKinds: [] as MemberKind[],
    entries: byGroup.get(g)!,
  }));
})();

export const KIT_ADDONS: KitAddon[] = [
  {
    key: 'feminine-hygiene',
    label: 'Feminine hygiene',
    triggerKinds: ['adult_female'],
    entries: [
      {
        id: 'fem-pads',
        label: 'Pads / tampons',
        group: 'Personal care',
        category: 'sanitation',
        keywords: ['pad*', 'tampon*', 'vložk*', 'menstruač*', 'hygienic*'],
        rationale: 'A monthly necessity that runs out — keep a buffer.',
      },
    ],
  },
  {
    key: 'baby',
    label: 'Baby supplies',
    triggerKinds: ['infant', 'toddler'],
    entries: [
      {
        id: 'baby-diapers',
        label: 'Diapers',
        group: 'Baby',
        category: 'sanitation',
        keywords: ['diaper*', 'plen*', 'nappy', 'nappies', 'plín*'],
        rationale: 'Days of diapers per child.',
      },
      {
        id: 'baby-formula',
        label: 'Infant formula',
        group: 'Baby',
        category: 'food',
        keywords: ['formula', 'sunar', 'kojeneck*', 'počáteční mléko', 'sušené mléko'],
        rationale: 'Feeding backup if breastfeeding is interrupted.',
      },
      {
        id: 'baby-wipes',
        label: 'Baby wipes',
        group: 'Baby',
        category: 'sanitation',
        keywords: ['wipe*', 'ubrousk*', 'vlhčen*'],
        rationale: 'Cleaning without running water.',
      },
      {
        id: 'baby-food',
        label: 'Baby food',
        group: 'Baby',
        category: 'food',
        keywords: ['baby food', 'příkrm*', 'dětsk* výživ*', 'přesnídávk*'],
        rationale: 'Shelf-stable jars / pouches.',
      },
    ],
  },
];

// Full library of packs a user can drop into any (custom) checklist as a
// pre-prepared group: the FEMA groups + the household add-ons.
export const KIT_PACKS: KitAddon[] = [...FEMA_GROUP_PACKS, ...KIT_ADDONS];
