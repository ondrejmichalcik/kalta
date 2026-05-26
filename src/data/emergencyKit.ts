// ============================================================================
// Kalta – Emergency kit checklist (Sprint 6, coverage gaps)
// Curated set based on FEMA Ready.gov "Build A Kit". Each entry is matched
// against inventory item names by keyword (EN + CZ) — fuzzy by design, false
// negatives are handled by local manual dismiss. `category` is used when a
// gap is pushed to the shopping list.
// ============================================================================
import type { Category } from '@/src/types/database';

export interface KitItem {
  id: string;
  label: string;
  group: string;
  category: Category | null;
  keywords: string[];
  rationale: string;
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
  },
  {
    id: 'can-opener',
    label: 'Manual can opener',
    group: 'Food',
    category: 'tools_safety',
    keywords: ['opener*', 'otvírák*'],
    rationale: 'Canned food is useless without a way to open it.',
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
    keywords: ['batter*', 'bateri*', 'aa', 'aaa'],
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
