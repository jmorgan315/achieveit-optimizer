## Diagnosis

### Bug — Skipped levels create duplicate leaves (Test 5)

**Root cause is in `parseHierarchicalColumns.ts`, not in `resolveHierarchyColumns`.** The lockstep filter is doing exactly what it should: when the user skips Tactic on Tulane (Pattern C / `column_nested`), `resolution.resolvedColumnIndices` correctly collapses to `[Goal, Objective, Strategy]` and the parser walks that shorter chain.

The bug is the leaf-creation contract at lines 597–604:

```ts
// Leaves are ALWAYS unique (each data row is its own leaf, even if name repeats).
// Parents are deduped by (depth + path).
if (!isLeaf) {
  const existing = parentByKey.get(dedupeKey);
  if (existing) { parentId = existing.id; continue; }
}
```

The "leaves are always unique" rule was designed for the normal case where every data row carries its own distinct leaf value. When the user skips the deepest configured level, what *used* to be a parent (Strategy) becomes the new leaf. Tulane has ~13 source rows under one Goal/Objective/Strategy block, each of which was previously a distinct Tactic leaf. After skipping Tactic:

- Pattern C path (line 550): `leafDepthIdx = filled.length - 1` → Strategy.
- For data rows 2..13 of that block, the Strategy raw cell is **blank** (Tulane uses inheritance: Strategy text only on the first row of each block). `filled[Strategy]` is populated by `lastNonBlank` inheritance.
- Because `isLeaf === true`, dedup is bypassed → 13 leaf items with identical path "Goal > Obj > Strategy" are pushed.

Confirmation: the bug count (~13 dupes) matches the source row count under that Strategy. So per-row leaf creation is the failure, not pathkey construction.

**Why this only surfaces when skipping middle/deepest levels:** without skipping, the deepest configured column was Tactic, which has a unique raw value per row, so "leaves always unique" was correct. With skipping, the new leaf column carries inherited values across rows.

### Bug — Mixed selection (Pattern A + B/C) falls back to legacy mapping (Test 1)

**Root cause in `SpreadsheetImportStep.tsx` `tryDispatchHierarchical` lines 409–495.** The dispatch is all-or-nothing:

```ts
const allHierarchical = selected.every(s => s.decision.kind === 'hierarchical');
const allGeneric = selected.every(s => s.decision.kind === 'generic');
if (!allHierarchical) {
  if (allGeneric) { /* generic-confirm */ }
  // mixed → fallback to legacy MappingInterface
}
```

When DRAFT has Initiative 1 (Pattern A → generic) checked alongside any Pattern B/C sheet, `allHierarchical` is false AND `allGeneric` is false, so it returns `kind: 'fallback'` for every sheet, dropping into the legacy aggregated `MappingInterface`. There is no `kind: 'mixed-confirm'` branch yet — that's the gap. The 4d.1.1 work added generic-confirm for the all-generic case but never extended it to handle a mix.

## Fixes (both inside 4d.2.a scope)

### Fix 1 — Dedup inherited leaves

**File:** `src/utils/parsers/parseHierarchicalColumns.ts`

In the row loop (~line 581), make a leaf participate in `parentByKey` dedup whenever its value at the leaf depth came from inheritance rather than the row's own raw cell. The signal already exists locally: `rawValues[d]` is the un-inherited cell, `filled[d]` is post-inheritance.

Replace the "leaves are always unique" branch:

```ts
const isLeaf = d === leafDepthIdx;
const leafIsInherited = isLeaf && !rawValues[d];

// Parents OR inherited leaves dedup by (depth + path).
// Only "real" leaves (raw cell present at leaf depth) stay unique.
if (!isLeaf || leafIsInherited) {
  const existing = parentByKey.get(dedupeKey);
  if (existing) {
    parentId = existing.id;
    if (isLeaf) {
      // Inherited leaf collapsed into existing — done with this row.
      break;
    }
    continue;
  }
}
```

Also: when an inherited leaf is freshly created, register it in `parentByKey` so subsequent rows collapse:

```ts
items.push(item);
if (!isLeaf || leafIsInherited) {
  parentByKey.set(dedupeKey, item);
  parentId = item.id;
}
```

This preserves the existing Tulane-no-skipping behavior (Tactic always raw → unique leaves) and fixes the skip-level duplicate behavior. It also benignly improves any other Pattern C sheet where the deepest column happens to inherit.

**Edge case:** when the inherited leaf is created from one row, attribute attachment (owner, dueDate, description, etc., lines 622–650) runs only on that first row. Subsequent rows that collapse just lose their per-row attributes — which is correct behavior since those attributes were originally hung on Tactic, the level the user explicitly skipped. No additional merge logic needed in 4d.2.a; if it becomes a complaint we revisit in a later phase.

### Fix 2 — Mixed routing into MappingConfirmation

**File:** `src/components/steps/SpreadsheetImportStep.tsx`

Replace the all-or-nothing branch (~lines 409–495) with a per-sheet split that always lands in `mapping-confirmation` whenever every selected sheet is *either* hierarchical or generic-with-classification. Concretely:

1. Drop the `allHierarchical` / `allGeneric` early gate. Continue to fall back only if any selected sheet has `decision.kind === 'generic'` AND no classifier entry (genuine no-op).
2. Run the existing per-sheet hierarchical loop (lines 504–565) only over `selected.filter(s => s.decision.kind === 'hierarchical')`.
3. Build the generic preview block (existing lines 412–485) over `selected.filter(s => s.decision.kind === 'generic' && s.cls)`. Bucket those items into `itemsBySheet` keyed by sheet name.
4. Return a new variant `kind: 'mixed-confirm'` carrying both `perSheet` (hierarchical sheets) and `preview` (generic sheets), plus a unified `sheetNames` list in selection order.
5. In the caller (~line 235), accept `'mixed-confirm'` alongside the existing kinds: setHierResultsBySheet for the hierarchical half, setGenericPreview for the generic half. Conflicts (if any) carry over as today.

`MappingConfirmation` already renders one card per sheet keyed by name and routes Adjust per-pattern via the per-sheet button shipped earlier — no changes needed there as long as both maps are populated.

**Bonus:** this also collapses the rare current case where a single Pattern A sheet selection works via generic-confirm but adding any B/C sheet breaks it.

### Out of scope

- Test 6 tooltip artifact — defer to next round (UI-only, low priority).
- Restructuring leaf-attribute merge for collapsed inherited leaves — defer; current "first row wins" is acceptable for the skip-level use case.
- 4d.2.b / 4d.2.c wiring — still gated.

## Files changed

- `src/utils/parsers/parseHierarchicalColumns.ts` — inherited-leaf dedup in the row loop.
- `src/components/steps/SpreadsheetImportStep.tsx` — split dispatch by sheet, add `mixed-confirm` result variant + caller branch.

## Validation after deploy

1. Tulane skip-Tactic → Live Preview and final import show ONE Strategy parent per Goal/Objective block, not 13.
2. Tulane skip-middle (Objective) → similar collapse, descendants still parent up correctly.
3. Tulane normal mapping (no skipping) → unchanged item count vs. current production.
4. DRAFT multi-sheet with Initiative 1 (A) + any B/C sheet → MappingConfirmation renders per-sheet cards with per-sheet Adjust, no fallback to legacy MappingInterface.
5. DRAFT all-generic and all-hierarchical selections → no regression.
