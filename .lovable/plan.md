## Phase 4d.2.b — Wire row-predicate Apply/Undo into MappingConfirmation

Most infrastructure already exists in source as inert code. Scope is to flip the gate on, pass per-sheet active-state into the directives card, and extend the handlers to cover Pattern A (`genericPreview`) sheets in addition to hierarchical (`hierResultsBySheet`) sheets.

### Findings from current code

- `MappingConfirmation.tsx` already accepts `onApplyPredicate`, `onUndoPredicate`, and an `onIgnoreDirective` (its existing name for "ignore predicate"). When `directivesEnabled.predicates === true`, it already renders the active Apply/Undo buttons and shows the Applied badge keyed off `row.activeOnSheets.length > 0` and `row.removedCount`. It also already disables Apply with the right tooltip when `parsed.kind === 'too-complex'`.
- `SpreadsheetImportStep.tsx` already implements:
  - `parsePredicate` / `applyPredicate` import (line 36)
  - `activePredicatesBySheet`, `predicateBaselineBySheet` state (lines 145–146)
  - `reparseAndRefold` (lines 946–988): re-parses and re-folds active predicates
  - `handleApplyPredicate` / `handleUndoPredicate` (lines 1016–1048)
  - `applyPredicate` cascades parent removals to descendants via `parentId` traversal — orphan handling is already correct.
- Two real gaps:
  1. `directivesEnabled={{ predicates: false, cellRules: false }}` (line 1267) — gate is closed.
  2. `predicateRows` is built with `activeOnSheets: []` and `removedCount: 0` (lines 1222–1227) — Apply state never reflects in the UI even after a successful apply.
  3. `handleApplyPredicate` / `handleUndoPredicate` only iterate `hierSheetOrder` over hierarchical sheets and call `reparseAndRefold` (which only touches `hierResultsBySheet`). Pattern A sheets (`genericPreview.itemsBySheet[name]`) are not filtered today.
  4. `onApplyPredicate` / `onUndoPredicate` callbacks are not currently passed to `<MappingConfirmation>`.

### Changes

**1. `src/components/steps/SpreadsheetImportStep.tsx`**

- Track per-sheet baseline + last-removed counts for generic preview as well:
  - Add `genericPredicateBaselineBySheet: Record<string, PlanItem[]>` and reuse `activePredicatesBySheet` (keyed by sheet name) for both modes.
- Extend `handleApplyPredicate(predicate)` to also handle Pattern A sheets:
  - For each sheet name in `genericPreview?.itemsBySheet ?? {}`:
    - On first apply, snapshot the current items into the generic baseline.
    - Recompute filtered items by starting from the **baseline** and re-applying every predicate in `nextPreds` (mirrors hier path so multi-predicate ordering is order-safe).
    - Headers come from the corresponding `parsedSheet` for that generic sheet (look up in `detection?.sheets`).
    - Update `genericPreview` immutably: `setGenericPreview(prev => ({ ...prev, itemsBySheet: { ...prev.itemsBySheet, [sheetName]: filtered } }))`.
    - Log `predicate-applied` to `parser_diagnostics` with `parser_name: 'ssphase4d2b'` carrying `{ sheet, predicate, kind, itemsBefore, itemsAfter, removedCount, mode: 'generic' }`.
- Extend `handleUndoPredicate(predicate)` symmetrically for `genericPreview` (re-fold remaining predicates from baseline; if `nextPreds` is empty, restore baseline directly).
- Track `removedCountByPredicateBySheet: Record<sheet, Record<predicate, number>>` so the UI can show "removed N rows" per sheet/predicate. Updated inside both Apply paths.
- Build `predicateRows` (around line 1222) with real values:
  ```ts
  const predicateRows: PredicateRow[] = (parserDirectives?.exclude_row_predicates ?? []).map(p => {
    const activeOnSheets = Object.entries(activePredicatesBySheet)
      .filter(([, preds]) => preds.includes(p))
      .map(([s]) => s);
    const removedCount = activeOnSheets.reduce(
      (n, s) => n + (removedCountByPredicateBySheet[s]?.[p] ?? 0), 0);
    return { predicate: p, parsed: parsePredicate(p, headersForParse), activeOnSheets, removedCount };
  });
  ```
  Also emit `predicate-parsed` diagnostic per predicate the first render (guarded by a `useEffect` on the predicate list).
- Flip the gate: `directivesEnabled={{ predicates: true, cellRules: false }}`.
- Pass the callbacks:
  ```ts
  onApplyPredicate={handleApplyPredicate}
  onUndoPredicate={handleUndoPredicate}
  ```
  Keep the existing `onIgnoreDirective` for Ignore (already wired) and additionally log `predicate-ignored` under `parser_name: 'ssphase4d2b'` for traceability (in addition to the existing `ssphase4d`/`directive-ignored` log).

**2. `src/components/spreadsheet/MappingConfirmation.tsx`**

No prop-shape changes needed — the component already exposes `onApplyPredicate`, `onUndoPredicate`, `onIgnoreDirective` and renders all three states (active, applied+Undo, too-complex disabled+tooltip). Only confirm:
- Tooltip copy for `too-complex` reads "This rule is too complex to apply automatically." Update to the spec wording: *"This rule is too complex to apply automatically. Use 'Adjust' to manually exclude rows."*
- Cell-rule rows continue to show disabled Apply with "Coming soon — 4d.2.c" tooltip (unchanged).

**3. No changes** to `applyRowPredicate.ts` — orphan/cascade handling already in place.

### Diagnostics (parser_name = 'ssphase4d2b')

- `predicate-parsed` — `{ predicate, kind, args }` once per predicate when MappingConfirmation first mounts with directives.
- `predicate-applied` — per sheet: `{ sheet, predicate, kind, mode: 'hier' | 'generic', itemsBefore, itemsAfter, removedCount, activeCount }`.
- `predicate-undone` — per sheet: `{ sheet, predicate, mode, itemsAfter, activeCount }`.
- `predicate-ignored` — `{ predicate }`.

### Out of scope (deferred)

- Cell-rule Apply (4d.2.c) — buttons stay disabled with current tooltip.
- New predicate kinds beyond `column-equals`, `column-contains`, `starts-with`.
- Persisting active predicates across session resume.

### Validation matrix

| Test upload + note | Expected |
|---|---|
| DRAFT, "skip rows where status = Closed" | Parsed `column-equals`; Apply enabled; click → matching rows + descendants removed; badge "✓ Applied — removed N rows" + Undo |
| DRAFT, "skip rows starting with Draft" | Parsed `starts-with`; Apply works on name/description |
| DRAFT, "skip rows containing Pending" | Parsed `column-contains`; Apply works |
| DRAFT, long compound sentence | Parsed `too-complex`; Apply disabled with updated tooltip |
| Pattern A sheet (Initiative 1 with note) | `genericPreview.itemsBySheet[name]` filtered, count updates on the sheet card |
| Pattern B/C sheet (Tulane with note) | `hierResultsBySheet[name].items` filtered, count updates |
| Click Undo | Items restored; if it was the only active predicate, baseline state returned exactly |
| Click Ignore | Row marked dismissed, no filtering; `predicate-ignored` log fires |
| Continue after Apply | Filtered items flow into final import via existing `finalizeFromMixed/Generic/HierSnapshots` paths |
| No-regression: Tulane skip-Tactic still 1 Strategy per block; Santa Cruz 730; Carmen 17 | Unchanged |

### No-hardcoding guarantees

- All predicate matching uses regex in `parsePredicate` against the AI's text.
- Header lookup uses `stemKey` fold (existing 4b.1 helper).
- No filename or sheet-name conditionals introduced.

### Files changed

- `src/components/steps/SpreadsheetImportStep.tsx`
- `src/components/spreadsheet/MappingConfirmation.tsx` (tooltip copy only)
- `.lovable/plan.md` (phase log update)
