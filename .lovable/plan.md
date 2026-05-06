# Phase 4d.2.b — Bug-Fix Plan (Bugs 1, 2, 3)

Ship in order: Bug 1 → Bug 2 → Bug 3.

---

## Bug 1 — Carry source-row data on PlanItem so Skip-mapped columns are filterable

### 1a. `src/types/plan.ts`
Add optional field:
```ts
/** Phase 4d.2.b — original source-row data keyed by header text.
 *  Populated only at leaf creation. Distinct from PlanItem.status. */
rawRowData?: Record<string, string>;
```

### 1b. `src/utils/parsers/parseHierarchicalColumns.ts`
Inside the `if (isLeaf)` block (~line 620), build a header→value map from the source row's full header set and assign to `item.rawRowData` before the existing role attachments. Capture `headerRow` once at the top of the row loop if not already in scope.

### 1c. `src/utils/spreadsheet-parser.ts` (Pattern A)
In `generatePlanItems`, populate `rawRowData` on:
- **Strategy branch** `actionItem` (~line 640) — using `sectionColMap`
- **Generic branch** `item` (~line 743) — using `colIndexMap`

Skip on parents (Strategy/Outcome/Section items) and on `measItem` (Level 4 derivative — cascade handles it via parentId).

### 1d. `src/utils/parsers/applyRowPredicate.ts`
- `findHeader`: split input on `/` and try each segment via stem-fold; return first match.
- `fieldFor(item, columnHeader)`: prefer `item.rawRowData` lookup via stem-folded key match. Legacy fallback only when `rawRowData` missing. **Deliberately do NOT route source "Status" to `item.status`** (lifecycle ≠ source data).
- Pass raw `parsed.columnHeader` to `fieldFor` (header resolution moves inside).

---

## Bug 2 — Parser regex gaps (`applyRowPredicate.ts`)

- Define `Q = ["“”'‘’]` (curly + straight quotes, single + double).
- Add **column-scoped starts-with**: `rows where <col> starts with <text>` → emits `column-contains`-style match scoped to that column. (Falls through to bare starts-with if header doesn't resolve.)
- Broaden existing `column-equals` and `column-contains` regexes to use `Q`.
- Bare starts-with regex unchanged in semantics, just uses `Q`.
- Header `/`-split handled by `findHeader` from Bug 1d.

---

## Bug 3 — Classifier prompt (`supabase/functions/classify-spreadsheet-layout/index.ts` line 65)

Replace one-line description with explicit guidance to preserve simple forms:
- Don't invent column qualifiers when user didn't name a column.
- Don't join ambiguous columns with `/`.
- Accepted forms: `rows starting with X`, `rows where Col = X`, `rows where Col contains X`, `rows where Col starts with X`.
- More complex notes → leave near user's wording (parser will mark too-complex).

No schema change.

---

## Validation matrix

| Scenario | Expected |
|---|---|
| Tulane "skip rows where Status = ongoing" | `column-equals(Status, ongoing)`; ~66 leaves + descendants removed |
| Tulane "skip rows where Tactic/Description starts with Draft" | `findHeader` resolves first matching segment; column-scoped match |
| DRAFT "skip rows starting with Draft" | bare `starts-with` on name/description |
| Curly-quoted note `'Status' is 'Closed'` | parses cleanly |
| Pattern A sheet (Initiative) | `genericPreview.itemsBySheet[name]` filtered via `rawRowData` |
| No-regression: Tulane=170, Santa Cruz=730, Carmen=17 | Unchanged |

## Files changed

- `src/types/plan.ts`
- `src/utils/parsers/parseHierarchicalColumns.ts`
- `src/utils/spreadsheet-parser.ts`
- `src/utils/parsers/applyRowPredicate.ts`
- `supabase/functions/classify-spreadsheet-layout/index.ts`
- `.lovable/plan.md`

## Out of scope

- Cell-rule Apply (4d.2.c)
- Resume-session rehydration of `rawRowData` (in-memory this phase)
- Upward parent cascade (downward only per Q2)
