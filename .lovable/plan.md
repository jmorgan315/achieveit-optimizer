# Phase 4b: Unified Pattern B/C parser + user-stated levels

Builds the parser that consumes classifier output for **Pattern B** (flat list with hierarchy in category columns) and **Pattern C** (column-nested explicit hierarchy), then wires user-stated hierarchy levels from Screen 2 with a conflict-resolution UI.

Ship in **two sub-phases** with a validation pause between them. No filename, sheet-name, or column-string heuristics — every structural decision flows from `layout_classification.sheets[].structure`, runtime cell content, or user input.

---

## 4b.1 — Parser + dispatch wiring (no user levels yet)

### New file: `src/utils/parsers/parseHierarchicalColumns.ts`

```ts
export function parseHierarchicalColumns(
  sheet: ParsedSheet,
  sheetClassification: SheetClassification,
  userLevels?: string[]
): { items: PlanItem[]; allColumnHeaders: string[]; unresolvedLevels?: string[] }
```

Algorithm:

1. **Resolve hierarchy column positions** in priority order:
   - `userLevels` (if present, non-empty) → case/trim-tolerant match against the header row at `structure.header_row_index`.
   - else `structure.implied_levels`.
   - For levels that don't match a header, fall back to ordinal column position (level index → column index).
   - If neither resolves and ordinal fallback doesn't fit (more levels than columns), return `unresolvedLevels` so the mapping UI can prompt.
   - Log: `[ssphase4b] resolve-levels: provided=[...] resolved-columns=[...]`.

2. **Walk data rows** starting at `structure.data_starts_at_row`:
   - Track per-column "last non-blank value" top-to-bottom for **blank-cell inheritance**.
   - Build the row's hierarchy path by reading each resolved hierarchy column (with inheritance fill).
   - Variant by `structure.hierarchy_signal`:
     - `category_columns` (Pattern B): partial paths are valid leaves. Deepest non-blank cell in the chain is the leaf level for that row.
     - `column_nested` (Pattern C): expect full chain; gaps fill from inheritance; deepest configured level is always the leaf.

3. **Build parents from unique paths**: walk the path level-by-level, dedupe `(depth, value)` pairs to reuse parents. Deepest level = `PlanItem` leaf; intermediate levels = parent containers.

4. **Leaf name**: column resolved for the deepest level; fallback to `structure.name_column_index` only if step 1 fails (it's known unreliable per Phase 3).

5. **Attach attributes** to leaf items only. For each non-hierarchy column, use existing `getDefaultColumnRole` to assign roles (assigned-to, dates, status, notes, metric).

6. **Logging**:
   - `[ssphase4b] parsed: sheet=X pattern=Y items=N parents-created=M`
   - `[ssphase4b] hierarchy: levels=[...] resolved=[...] unresolved=[...]`

### Dispatch in `SpreadsheetImportStep.tsx`

Add Pattern B/C routing alongside the existing path. Pseudocode:

```
for each selected sheet:
  cls = layout_classification.sheets[idx]
  switch (cls.pattern, cls.confidence):
    A & conf>=80           → detectGenericPattern (unchanged)
    (B|C) & conf>=80       → parseHierarchicalColumns(sheet, cls, undefined)
    (B|C) & conf<80        → parseHierarchicalColumns + warn log
    D                      → detectGenericPattern + warn (deferred to 4e)
    null/unknown/missing   → detectGenericPattern (unchanged)
```

Log: `[ssphase4b] route: sheet=X pattern=Y confidence=Z dispatched-to=...`.

### Files affected (4b.1)
- **NEW** `src/utils/parsers/parseHierarchicalColumns.ts`
- `src/components/steps/SpreadsheetImportStep.tsx` — dispatcher

### Validation pause after 4b.1
User tests against three files (no user levels set) and confirms item counts/hierarchy before moving on:
- Santa Cruz Operational Plan → Pattern B, ~559 leaf items
- Carmen/Zonetta TI Template → Pattern C, ~25 leaf items
- AchieveIt All In → Pattern C, ~191 leaf items

If counts or structure are off, fix the parser before adding user-levels logic.

---

## 4b.2 — User-stated levels integration

### Prop chain

`processingConfig.planLevels` (already on `state` in `Index.tsx`) → forward as `userLevels?: string[]` down:

- `Index.tsx` → `FileUploadStep` (new prop)
- `FileUploadStep.tsx` → `SheetPickerStep` and `SpreadsheetImportStep` (new prop on both)
- `SpreadsheetImportStep.tsx` → pass to `parseHierarchicalColumns` for B/C dispatches

If user didn't state levels, `userLevels` is undefined/empty and parser silently uses classifier's `implied_levels` — no conflict UI.

### Conflict detection

Compare `userLevels` vs `structure.implied_levels` per sheet:
- Equivalent if same length AND same values in order (case/trim-tolerant) → no conflict.
- Else → surface conflict UI when that sheet enters mapping.

Log: `[ssphase4b] level-conflict: sheet=X detected=true|false reason=length-mismatch|name-mismatch|none`.

### Conflict resolution UI (in `MappingInterface`)

Renders at the top of the mapping screen for the affected sheet:

```text
✨ AI Analysis

You said this plan uses 4 levels:
  Pillar → Goal → Strategy → Action

The AI detected 3 levels in this sheet:
  Goal → Strategy → Action

⚠️ Mismatch detected. Which is correct?
  ( ) Use my 4 levels — items assigned to Goal/Strategy/Action; Pillar empty
  ( ) Use AI's 3 levels — Pillar level ignored
  ( ) Let me reconfigure
```

- Default selection: **user's levels**.
- "Apply" re-runs the parser with the chosen level array.
- "Let me reconfigure" routes to the existing toggle-style mapping UI (no new UI in 4b — that's 4d).
- Per-sheet: if multiple sheets disagree differently, each gets its own resolution as the user proceeds.

### Picker info block

When `userLevels` is non-empty, show a small info row at the top of `SheetPickerStep`:

```text
ℹ️ You said this plan uses 4 levels: Pillar → Goal → Strategy → Action.
   We'll match these against detected structures.
```

Informational only — actual conflict UI lives in mapping.

### Files affected (4b.2)
- `src/pages/Index.tsx` — pass `state.processingConfig.planLevels` to `FileUploadStep`
- `src/components/steps/FileUploadStep.tsx` — accept + forward `userLevels`
- `src/components/steps/SheetPickerStep.tsx` — accept `userLevels`, render info block
- `src/components/steps/SpreadsheetImportStep.tsx` — accept `userLevels`, pass to parser, drive conflict UI state
- `src/components/spreadsheet/MappingInterface.tsx` — render conflict resolution UI when supplied with both level arrays

---

## Out of scope
- Pattern A enhancements (4c)
- Mapping UI redesign (4d)
- Pattern D parser (4e)
- Honoring `parser_directives.exclude_row_predicates` beyond informational
- Persisting user mapping overrides across sessions

## Anti-hardcoding sanity checks
The diff must contain **no**:
- Filename or sheet-name substring matches against the validation files
- Hardcoded column header strings ("Goal", "Objective", "Tactic", "Score Factor", etc.)
- Conditionals based on item counts seen in test files
- Pattern-matching on classifier prose strings

All structure decisions: classifier `structure.*` fields, runtime cell content, or `userLevels`.

## Report-back format (per sub-phase)
1. Files changed
2. What's in this sub-phase / what's deferred
3. Console log examples showing dispatch + parsing
4. Confirmation: no test-file-specific hardcoding in the diff
5. Validation scenarios for the user to run before approving the next sub-phase
