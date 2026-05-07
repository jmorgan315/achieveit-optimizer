
## Phase 4d.2.c hotfix #2 — Remap classifier-tagged levels to user-stated levels

### Bug

`cell_transformations[].level` is set once by the classifier using its own `implied_levels` (e.g. "Government Area"). When the user states different levels (Focus Area / Goal / Objective), neither the parser's level-name match nor Fix A's column-header fallback finds a hit, so transformations are silently skipped (0 cells transformed).

### Fix — position-based remap at Apply time

Remap each rule's `level` field per-sheet, immediately before pushing it into `activeCellTxBySheet`. Use the sheet's classifier `implied_levels` as the source positions and the parsed `resolvedLevels` (which already reflect `userLevels` when in effect) as the target positions.

### Changes

**`src/utils/parsers/parseHierarchicalColumns.ts`** — export a small helper:

```ts
export function remapCellTransformationLevels(
  rules: CellTransformation[],
  classifierLevels: string[],
  effectiveLevels: string[],
): { remapped: CellTransformation[]; dropped: Array<{ rule: string; level: string; reason: string }> }
```

Logic per rule:
- `t.level` empty → keep as-is (unscoped).
- find `i = classifierLevels.findIndex(l => stemKey(l) === stemKey(t.level))`
- `i < 0` → keep as-is (let parser's level-name + column-header fallbacks try).
- `i >= effectiveLevels.length` → drop, record reason `"position-beyond-user-levels"`.
- otherwise → substitute `level := effectiveLevels[i]`.

**`src/components/steps/SpreadsheetImportStep.tsx`** — modify `handleApplyCellRule` (around line 1165):

For each `sheetName` in `hierSheetOrder`:
1. Look up `hier = hierResultsBySheet[sheetName]` and its stored `classification.structure.implied_levels` (already kept on `hier.classification`).
2. Call `remapCellTransformationLevels([rule], classifierLevels, hier.resolvedLevels)`.
3. If `remapped.length === 0` (dropped), log `ssphase4d2c / cell-transformation-inapplicable` with sheet, original level, classifier levels, user levels — and skip this sheet.
4. Push the remapped rule (not the original) into `activeCellTxBySheet[sheetName]` and proceed with `reparseAndRefold`.

Also remap inside `handleUndoCellRule` matching: undo by original `key` (the pre-remap key persists on the UI rule list); when comparing to active rules we need to recover identity. Simplest: keep an auxiliary `Map<sheetName, Map<originalKey, remappedKey>>` populated on apply, and use it on undo. (Or compare by the original rule's `key` stored as a parallel field on the active entry — adding `originalKey?: string` to `CellTransformation` is fine; the parser ignores unknown fields.)

**Diagnostic additions (`ssphase4d2c`):**
- `cell-transformation-remap` per sheet — `{ originalLevel, classifierLevels, effectiveLevels, remappedLevel | null, dropped: bool, reason? }`.
- `cell-transformation-inapplicable` when fully dropped on every sheet — surfaces in admin diagnostics so we know the rule never fired.

### Out of scope
- Classifier prompt changes — keep the classifier emitting whatever level vocabulary it sees; remap is purely client-side.
- Pattern A path — cell rules already disabled there.

### Validation scenarios

1. **Santa Cruz reproducer**: classifier emits 5 levels including "Government Area" at position 0; user states 3 levels Focus Area/Goal/Objective. Apply `take-first-delimited` rule with `level:"Government Area"` → remaps to `level:"Focus Area"`, parser matches via `level-name`, cells-transformed > 0.
2. **Classifier level beyond user count**: rule tagged `level:"Service"` (classifier position 3) with user count = 3 → dropped, diagnostic logged, UI badge shows "0 affected" (no parser execution).
3. **Names match across user/classifier (Fix A scenario)**: rule `level:"Title"`, both classifier and user have "Title" at same position → remap is a no-op, behavior unchanged.
4. **Unscoped rule** (`t.level` undefined) → passes through untouched, parser applies to all positions.
5. **Multi-sheet, different classifier levels**: two hier sheets with different `implied_levels` but same user override; remap runs per-sheet, each sheet substitutes via its own classifier basis.
6. **Undo after apply**: rule remains in `parserDirectives` UI list; undo correctly removes the (remapped) entry from `activeCellTxBySheet` and re-parses.
7. **"Let me adjust" path**: open `LevelMappingInterface` after applying; `cellTransformations` passed through are already remapped; parser inside the modal re-applies cleanly.

### Files touched
- `src/utils/parsers/parseHierarchicalColumns.ts` (export helper)
- `src/components/steps/SpreadsheetImportStep.tsx` (use helper in apply/undo, add diagnostics)
- `.lovable/plan.md` (record hotfix #2)
