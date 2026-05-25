// ============================================================================
// Kalta – Coupled field groups for sync conflict detection
// Some fields only make sense as a pair: picking `quantity = 9` without
// also choosing `unit = pack` is meaningless when the other side has 25 pcs.
// Promotion ensures both peers / both sync paths land on the same set of
// conflict fields, which keeps resolution maps comparable and the UI
// consistent across cloud sync (`/conflicts` screen) and P2P review.
// ============================================================================

const COUPLED_FIELDS: Record<string, string[][]> = {
  items: [['quantity', 'unit']],
};

/**
 * Mutates `conflictFields`. If any field in a coupled group is already
 * a conflict AND the other field in the group also changed (is in
 * `diffFields`), promote the coupled field to a conflict too.
 */
export function promoteCoupledConflicts(
  table: string,
  conflictFields: string[],
  diffFields: string[],
): void {
  const groups = COUPLED_FIELDS[table];
  if (!groups) return;
  for (const group of groups) {
    const anyConflict = group.some((f) => conflictFields.includes(f));
    if (!anyConflict) continue;
    for (const f of group) {
      if (conflictFields.includes(f)) continue;
      // Only promote fields that are actually changing — if the unit
      // didn't move at all, there's nothing to disagree about.
      if (diffFields.includes(f)) {
        conflictFields.push(f);
      }
    }
  }
}

/**
 * Returns the coupling group a field belongs to (or null). Used by UI
 * to render a single combined picker for related fields.
 */
export function coupledGroupOf(table: string, field: string): string[] | null {
  const groups = COUPLED_FIELDS[table];
  if (!groups) return null;
  return groups.find((g) => g.includes(field)) ?? null;
}
