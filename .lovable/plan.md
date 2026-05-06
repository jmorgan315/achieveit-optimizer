# Phase 4d.2.c — Wire cell-level transformations

Most infrastructure already exists from earlier inert work: `CellTransformation` type, `cellTransformations` parameter in `parseHierarchicalColumns` (with `cellsTransformedCount` returned as `cellsTransformed`), classifier `cell_transformations` extraction, `handleApplyCellRule` / `handleUndoCellRule` in `SpreadsheetImportStep`, `cellTxBaselineBySheet` state, `dismissedCellRuleKeys` state, and `MappingConfirmation` rendering with `onApply/Undo/IgnoreCellRule` props.

What's missing: the gate flag is still `cellRules: false`, the parent doesn't pass the three cell-rule callbacks, no `handleIgnoreCellRule`, the `cellRuleRows` always reports `activeOnSheets: []` and `cellsTransformed: 0`, no per-rule disable for Pattern A (Option B), and the per-session "detected" diagnostic isn't fired.

## Scope decision

**Option B**: Pattern A out of scope. The existing handlers only loop `hierSheetOrder`. When the dispatched set has no hierarchical sheets, we render the rule with a disabled Apply button and a tooltip explaining the limitation. Santa Cruz (Pattern B) is the primary target; deferring Pattern A keeps the change small and avoids touching `generatePlanItems`.

## Changes

### 1. `src/components/steps/SpreadsheetImportStep.tsx`

- Add a `cellsTransformedByRuleSheet: Record<sheetName, Record<ruleKey, number>>` state (parallel to `removedCountByPredicateBySheet`).
- In `handleApplyCellRule`, after `reparseAndRefold`, write `r.cellsTransformed` into that state for `(sheetName, key)`.
- In `handleUndoCellRule`, delete that entry.
- Add `handleIgnoreCellRule(key)`: add `key` to `dismissedCellRuleKeys`, log `cell-transformation-ignored` with `{ rule, level }` resolved via `allCellRules.find`.
- When building `cellRuleRows` (~line 1342), populate:
  - `activeOnSheets`: sheets where `activeCellTxBySheet[sheet]` includes a rule with the matching `cellRuleKey`.
  - `cellsTransformed`: sum of `cellsTransformedByRuleSheet[sheet][key]` across `activeOnSheets`.
- One-shot `cell-transformation-detected` log per session: ref a `useEffect` keyed on `parserDirectives?.cell_transformations` length so we log once when directives first arrive (guard with a `useRef` flag to avoid duplicates on re-renders).
- Flip `directivesEnabled={{ predicates: true, cellRules: true }}`.
- Pass `onApplyCellRule={handleApplyCellRule}`, `onUndoCellRule={handleUndoCellRule}`, `onIgnoreCellRule={handleIgnoreCellRule}` to `MappingConfirmation`.
- Pass a new `hasHierarchicalSheets: boolean` prop (true when `hierSheetOrder.some(n => hierResultsBySheet[n]?.parsedSheet)`).

### 2. `src/components/spreadsheet/MappingConfirmation.tsx`

- Add prop `hasHierarchicalSheets?: boolean` (default `true` for back-compat).
- In the cell-rule rendering branch where `cellRulesEnabled === true`:
  - If `!hasHierarchicalSheets` and not active → render disabled Apply with tooltip: "Cell rules currently apply only to hierarchical patterns (B/C)." Ignore stays enabled.
  - Otherwise behave like the predicate row: Apply (enabled), Undo when active, Ignore (disabled when active or already dismissed).
- Keep the legacy `cellRulesEnabled === false` "Coming soon — 4d.2.c" tooltip path untouched.

### 3. No changes to `parseHierarchicalColumns.ts`

`cellsTransformed` is already returned and surfaced through `reparseAndRefold`. The per-cell diagnostic log was deemed unnecessary — the aggregate `cellsTransformed` count is enough for the "affected N rows" badge and the `cell-transformation-applied` log.

## Diagnostics (parser_name = `ssphase4d2c`)

- `cell-transformation-detected` — fired once per session on first directives arrival: `{ rules: [{ rule, level, delimiter }] }`.
- `cell-transformation-applied` — already fired in handler.
- `cell-transformation-undone` — already fired in handler.
- `cell-transformation-ignored` — added in new handler.

## Files changed

- `src/components/steps/SpreadsheetImportStep.tsx`
- `src/components/spreadsheet/MappingConfirmation.tsx`
- `.lovable/plan.md`

## Out of scope

Pattern A cell-rule application; per-cell logging; cross-session persistence. Same as 4d.2.b semantics for "first row wins" attribute data.

## Validation

| Scenario | Expected |
|---|---|
| Santa Cruz upload with both directive notes | Two cell rules in card, Apply enabled |
| Apply take-first-delimited | "1. … ;#2. …" → "1. …", item count drops, badge shows N affected, Undo present |
| Apply resolve-numeric-reference | "5;6" → "5. Dynamic Economy; 6. Operational Excellence" |
| Apply both, then Undo each | State restores in reverse |
| Tulane (no cell rules) | Cell-rule subsection not rendered |
| Pattern A only (DRAFT) with cell-rule notes | Rules render; Apply disabled with tooltip; Ignore enabled |
| Regression baselines (Tulane 169/52, Santa Cruz 729, Carmen 14/17) | Unchanged when no cell rule applied |
