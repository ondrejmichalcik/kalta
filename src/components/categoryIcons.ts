// ============================================================================
// Kalta – Category → SF Symbol mapping
// Shared between the box detail list, the add-items form, and the readiness
// kit checklist. SF symbols are used as inline glyphs next to category text;
// for the larger brand 3D PNG renderings see CATEGORY_ICON / ResourceIcon.
// ============================================================================
import type { Category } from '@/src/types/database';
import type { SFSymbolName } from '@/src/components/Icon';

export const CATEGORY_SF: Record<Category, SFSymbolName> = {
  water: 'drop.fill',
  food: 'fork.knife',
  first_aid: 'cross.case.fill',
  light_power: 'bolt.fill',
  tools_safety: 'wrench.adjustable.fill',
  sanitation: 'bubbles.and.sparkles.fill',
  documents: 'doc.fill',
  other: 'shippingbox.fill',
};
