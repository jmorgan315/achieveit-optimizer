## Phase 4d.2 — LevelMappingInterface + Directive Apply

Three independently shippable chunks. Pause for validation between each. No filename / sheet-name / column-string heuristics; all decisions flow from `layout_classification`, runtime cell content, or user input.

---

### 4d.2.a — Column-to-Level mapping UI (Pattern B/C)

**New file:** `src/components/spreadsheet/LevelMappingInterface.tsx`

Two-column layout:
- **Left** — one row per level (from `userLevels` if set, else `structure.implied_levels`). Each row shows `Level N: <name>` plus a `<Select>` listing every parsed column with label `"<header or (no header)> — Column <A1-letter> (idx N) — XX% filled"`. Defaults to the current `resolvedColumnIndices[i]` from the prior parse. Below: collapsible "Other columns" (attribute-role selects mirroring legacy `MappingInterface`) and "Skipped columns".
- **Right** — `Live Preview` card: re-runs `parseHierarchicalColumns` (memoized) against the current selection and renders the first ~10 items (level chain + leaf name, indented).

Validation feedback:
- Two levels share the same column index → red Alert, **Apply disabled**.
- A level mapped to a column with 0% fill → yellow Alert (Apply allowed).

Footer: `[Cancel — Back to Confirmation]` and `[Apply Mapping]`.

**Parser extension** (`src/utils/parsers/parseHierarchicalColumns.ts`):

Add optional 4th arg `userLevelColumnIndices?: number[]`. When supplied and `length === userLevels.length`, the resolver bypasses header-stem matching and uses the supplied indices directly; `resolvedColumnIndices` mirrors the override and `resolvedLevels` mirrors `userLevels`. Existing header-match + ordinal fallback is unchanged when the param is absent.

**SpreadsheetImportStep wiring:**

- New phase `'level-mapping'` plus state `levelMappingTarget: { sheetName, classification, parsedSheet, currentResolvedIndices, currentLevels } | null`.
- `MappingConfirmation.onAdjust(sheetName)` branches on `clsBySheetName[sheetName].pattern`:
  - Pattern A → existing legacy `MappingInterface` route (unchanged from 4d.1.1).
  - Pattern B/C → set `levelMappingTarget` and `phase = 'level-mapping'`.
- On Apply: re-call `parseHierarchicalColumns(parsedSheet, classification, userLevels, userLevelColumnIndices)`, splice into `hierResultsBySheet[sheetName]`, clear target, return to `'mapping-confirmation'`.

**Diagnostic logs (`ssphase4d2a`):** `level-mapping-shown`, `level-mapping-applied` (itemsBefore/After), `level-mapping-cancelled`.

---

### 4d.2.b — Row-level directive Apply

**New file:** `src/utils/parsers/applyRowPredicate.ts`

```ts
type ParsedPredicate =
  | { kind: 'column-equals'; columnHeader: string; value: string }
  | { kind: 'column-contains'; columnHeader: string; text: string }
  | { kind: 'starts-with'; text: string }
  | { kind: 'too-complex' };

export function parsePredicate(predicate: string, headers: string[]): ParsedPredicate;
export function applyPredicate(items: PlanItem[], parsed: ParsedPredicate, headers: string[]): PlanItem[];
```

Three regex patterns, case-insensitive. Header match is stem-folded against `headers`. Anything else returns `'too-complex'`. `applyPredicate` filters `PlanItem[]` and also drops orphaned descendants (parent removed → children removed) to keep the tree consistent.

**MappingConfirmation update:**

For each predicate in `directives.excludePredicates`, run `parsePredicate` at render and:
- `too-complex` → `[Apply this filter]` disabled with tooltip "This rule is too complex to apply automatically."
- otherwise → `[Apply this filter]` active. On click: parent re-derives items with `applyPredicate`, updates the per-sheet snapshot, badge changes to `"✓ Applied — removed N rows"` with `[Undo]`.

**Parent state — accumulated active set (per sheet):**

```ts
appliedPredicatesBySheet: Record<string, Set<string>>   // active predicates currently filtering
predicateBaselineBySheet: Record<string, PlanItem[]>     // pre-any-predicate snapshot, captured on first Apply
```

Apply / Undo flow:
- On first Apply for a sheet, capture the current `hierResultsBySheet[sheet].items` into `predicateBaselineBySheet[sheet]`.
- Add/remove the predicate string in the active set.
- Recompute: start from baseline, fold every active predicate through `applyPredicate` in stable insertion order, write the result back into `hierResultsBySheet`.
- When the active set empties, drop the baseline entry.
- This guarantees applying B then A then undoing B leaves A still active with no ordering bugs.

**Diagnostic logs (`ssphase4d2b`):** `predicate-parsed` (per render, batched once per predicate), `predicate-applied` (kind, itemsBefore/After, removedCount, activeCount), `predicate-undone` (activeCount), `predicate-ignored`.

---

### 4d.2.c — Cell-level transformations

**New type** (`src/types/parser.ts`):

```ts
export type CellTransformation =
  | { rule: 'take-first-delimited'; level?: string; delimiter?: string }
  | { rule: 'resolve-numeric-reference'; level?: string };
```

**Classifier prompt** (`supabase/functions/classify-spreadsheet-layout/index.ts`):

Extend `parser_directives` schema with optional `cell_transformations[]`. System-prompt addendum: extract two known patterns from `documentHints` only — "pick/take the first … when multiple" → `take-first-delimited`; "if just a number, look up / resolve / match to named" → `resolve-numeric-reference`. If user phrasing doesn't fit either pattern, return `[]`. Multi-chunk merge: union by `(rule, level)`.

**Parser change** (`parseHierarchicalColumns`):

Add optional `cellTransformations?: CellTransformation[]`. Before path-key construction, for each hierarchy column cell, run `applyCellTransformations(rawValue, levelName, columnIndex, allRowsInColumn, transformations)`. `level` filter uses `stemKey` equality; missing `level` applies to all hierarchy cells.

**MappingConfirmation update:**

Inside the existing directives card, render a "Cell rules" subsection when `cell_transformations` is non-empty. Each row shows a plain-language description plus `[Apply this rule]` / `[Ignore]`. Apply triggers a re-parse via the parent.

**Parent state — accumulated active set (per sheet), mirrors 4d.2.b:**

```ts
appliedCellTransformationsBySheet: Record<string, CellTransformation[]>  // active rules, insertion order
cellTxBaselineBySheet: Record<string, { items, personMappings }>          // pre-any-transformation snapshot
```

Apply / Undo flow:
- On first Apply for a sheet, snapshot the current parse result into `cellTxBaselineBySheet[sheet]`.
- Add/remove the rule (compared by `(rule, level, delimiter)` tuple) in the active list.
- Recompute by re-calling `parseHierarchicalColumns(parsedSheet, classification, userLevels, userLevelColumnIndices, /* cellTransformations */ activeList)` with the **full merged active set** every time, then write the result into `hierResultsBySheet`.
- When the active list empties, restore the baseline and drop the entry.
- Important: the parser receives all currently-active transformations on every re-parse, so applying rule B never silently forgets rule A. Undo simply removes that rule from the active list and re-parses.

**Interaction with 4d.2.a + 4d.2.b:**
- If a level mapping is re-applied via `LevelMappingInterface` while cell transformations are active, the re-parse must include the active `cellTransformations` list so the new mapping inherits those rules.
- Row predicates (4d.2.b) operate on the post-parse `PlanItem[]`, so they re-fold from `predicateBaselineBySheet` after any cell-transformation re-parse — i.e. when cell transformations change, capture a fresh predicate baseline from the new parse output and re-apply the active predicate set on top.

**Diagnostic logs (`ssphase4d2c`):** `cell-transformation-detected` (from classifier output), `cell-transformation-applied` (rule, level, cellsTransformed, itemsBefore/After, activeCount), `cell-transformation-ignored`, `cell-transformation-undone`.

---

### Files touched

| File | a | b | c |
|---|---|---|---|
| `src/components/spreadsheet/LevelMappingInterface.tsx` (NEW) | ✓ | | |
| `src/utils/parsers/applyRowPredicate.ts` (NEW) | | ✓ | |
| `src/types/parser.ts` (CellTransformation type) | | | ✓ |
| `src/utils/parsers/parseHierarchicalColumns.ts` | ✓ (`userLevelColumnIndices`) | | ✓ (`cellTransformations`) |
| `src/components/steps/SpreadsheetImportStep.tsx` | ✓ phase + branching | ✓ apply/undo + accumulator | ✓ apply/undo + accumulator |
| `src/components/spreadsheet/MappingConfirmation.tsx` | ✓ pattern-aware adjust callback | ✓ predicate Apply UI | ✓ cell rules subsection |
| `supabase/functions/classify-spreadsheet-layout/index.ts` | | | ✓ schema + prompt |

### Out of scope
4c, 4e, persisting overrides across sessions, predicates beyond the 3 listed, transformations beyond the 2 listed, Pensacola PDF backlog, Tulane 8.3.1.2 triple-dup.

### Validation flow
Stop after each sub-phase; deliver report (files changed, deferred work, no test-file hardcoding confirmation, sample diag logs, validation scenarios, divergences). For 4d.2.c specifically, validate apply-A-then-B and apply-A-then-B-then-undo-A scenarios to confirm the merged active set behaves correctly.
