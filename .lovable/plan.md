# Phase 4d.2.c Hotfix #3 — Ground `cell_transformations.level` to `implied_levels`

Scope: `supabase/functions/classify-spreadsheet-layout/index.ts` only. No parser changes. Hotfix #2's position-based remap stays as defense-in-depth.

## Prompt diff

In the `cell_transformations` bullet (lines 77–80 of `PATTERN_GUIDE`), replace:

```
- cell_transformations: array — recognized cell-cleanup rules extracted from documentHints. Only emit entries that match these patterns; otherwise leave empty:
    * "take-first-delimited" when the user says to pick/take the first value when multiple are listed in a cell. Optionally include "delimiter" (default ";") and "level" (the level/column name they referenced).
    * "resolve-numeric-reference" when the user says number-only cells should be resolved to the corresponding named entry in the same column ("if just a number, look up / match to named"). Optionally include "level".
  Do NOT invent rules outside these two patterns.
```

with:

```
- cell_transformations: array — recognized cell-cleanup rules extracted from documentHints. Only emit entries that match these patterns; otherwise leave empty:
    * "take-first-delimited" when the user says to pick/take the first value when multiple are listed in a cell. Optionally include "delimiter" (default ";") and "level".
    * "resolve-numeric-reference" when the user says number-only cells should be resolved to the corresponding named entry in the same column ("if just a number, look up / match to named"). Optionally include "level".
  Do NOT invent rules outside these two patterns.

  RULES FOR THE "level" FIELD (critical — these prevent the most common classifier error):

  1. GROUNDING. The "level" value MUST be either:
       (a) empty/omitted (rule applies workbook-wide), OR
       (b) a case-insensitive match to one of the level names you put into some sheet's structure.implied_levels for this same response.
     NEVER write an arbitrary column header here. NEVER invent a level name. If the user's wording does not resolve to any implied_levels entry, leave "level" empty.

  2. SEMANTIC RESOLUTION — USER WORDING WINS. When documentHints references a level by name (e.g., "focus area", "objective", "tactic"), find the closest implied_levels entry across all sheets using stem-folded, case-insensitive, singular/plural-tolerant matching, and use the user's wording as the anchor:
       - If the user says "focus area" and any sheet's implied_levels contains "Focus Area", use "Focus Area" — even if you classified that same column on a different sheet as "Government Area", "Department Team", or any other label. The user's wording overrides your own level naming.
       - Your level naming is only a fallback for when the user did not name the level at all.
     If the user's term matches NO implied_levels entry on any sheet, leave "level" empty rather than substituting a near-miss header.

  3. ANTI-PATTERN GUARD — DO NOT GUESS FROM DATA SHAPE. The "level" field describes the user's intent, not the structural shape of the data. Do NOT pick a level (or column) just because that column happens to contain semicolon-delimited cells, numeric-only cells, or any other pattern that matches the rule. The data shape is irrelevant here; only the user's words in documentHints determine "level".
```

And in `layoutToolSchema`, replace the bare `level: { type: "string" }` (line ~114) with:

```
level: {
  type: "string",
  description: "Empty, OR a case-insensitive match to one of this response's implied_levels entries. NEVER an arbitrary column header. When the user named a level in documentHints, prefer the user's wording (resolved against implied_levels) over your own level interpretation.",
},
```

No other code or schema changes. The merge logic in the serve handler already keys on `(rule, level, delimiter)` and tolerates empty `level`, so no downstream changes needed.

## Validation matrix

| Workbook | documentHints | Expected `cell_transformations` |
|---|---|---|
| Santa Cruz | "Pick the first focus area when multiple are listed. If a cell contains just a number, align with the corresponding focus area name." | Two rules with `level: "Focus Area"` (or empty if classifier still uses 5-level scheme without "Focus Area"). NEVER `"Department Team"` / `"Government Area"` / other headers. |
| Santa Cruz | Detailed prompt with explicit Q/R column letters | Same as before — regression-only check. Hotfix #2 remap still kicks in if classifier picks a non-user level. |
| Santa Cruz | (none) | `cell_transformations: []` |
| DRAFT (Pattern A) | Notes unrelated to cell rules | `cell_transformations: []` (no leakage from non-rule notes) |
| Tulane | Cell-rule notes mentioning "Tactics" column | `level` matches a Tulane `implied_levels` entry (e.g., `"Tactic"`/`"Tactics"`), not a random header. |

Diagnostics to inspect after deploy: `parser_diagnostics` rows of type `cell-transformation-remap` should show fewer remaps (because classifier already grounds correctly). `cell-transformation-inapplicable` should not regress.

## Files touched
- `supabase/functions/classify-spreadsheet-layout/index.ts`
- `.lovable/plan.md` (changelog entry)
