## Phase 4d.2.c hotfix — Accept column header as `level` in cell transformations

### Problem
Classifier emitted `cell_transformations: [{ rule: 'take-first-delimited', level: 'Title' }]` because the user pointed at column "Title" (header text), but the level NAME at that position is "Objective". `applyCellTransformations` only stem-folds `t.level` against the level name, so every row is skipped → 0 transformed.

### Decision
**Path A** (parser flexibility). Match `t.level` against either the level name OR the column header at that position. Keeps it robust to the natural ways users describe targets in notes ("the Title column" vs "the Objective level"), without depending on a perfect classifier translation step.

### Change

**File:** `src/utils/parsers/parseHierarchicalColumns.ts`

`headerRow: string[]` is already in scope above `applyCellTransformations`. Pass it (or close over it) and update the level guard:

```ts
function applyCellTransformations(rawValue: string, levelName: string, levelIdx: number): string {
  if (!rawValue || activeTransformations.length === 0) return rawValue;
  let value = rawValue;
  for (const t of activeTransformations) {
    if (t.level) {
      const target = stemKey(t.level);
      const colIdx = resolution.resolvedColumnIndices[levelIdx] ?? -1;
      const headerName = colIdx >= 0 ? (headerRow[colIdx] || '') : '';
      const matchesLevel = target === stemKey(levelName)
                        || (headerName && target === stemKey(headerName));
      if (!matchesLevel) continue;
    }
    // ...existing rule branches unchanged
  }
  return value;
}
```

No other call sites change. `headerRow` is the same array already used elsewhere in the function.

### Diagnostics
Add one log on first non-trivial `applyCellTransformations` invocation per sheet capturing: `t.level`, matched-via (`level-name` | `column-header` | `unscoped`), `levelName`, `headerName`. Logged under `parser_name: 'ssphase4d2c'`, `log_type: 'cell-transformation-match'`. This makes it obvious in the admin Parser Diagnostics card which form the classifier produced.

### Validation
- Santa Cruz workbook with classifier output `level: "Title"` against the Objective column → `cellsTransformed > 0`, "Applied — affected N rows" badge populated, parsed item names show first-delimited values.
- Re-run with a synthetic `level: "Objective"` (level name form) → still works (regression check).
- Unscoped transformation (`level` omitted) → applies to all hierarchy levels (existing behavior preserved).
- Undo restores original counts.

### Out of scope
- No classifier prompt change. (Path B left as future tightening if we see misfires from the looser match.)
- No change to Pattern A path (still gated per 4d.2.c Option B).
