# Phase 4c.1 — `detectGenericPattern` consumes classifier output (rev 3)

Pure backend refactor. Goal: architectural consistency with Patterns B/C. Zero user-visible behavior change. Item counts unchanged across all regression files.

Rev 3 changes vs rev 2: explicit two-stage delivery (audit checkpoint → implementation), and Vitest fixtures sourced from real DB rows.

---

## 0. Two-stage delivery (hard checkpoint)

**Stage A — Pre-flight audit only. No production code written.**

1. Query `processing_sessions.layout_classification` for the six regression files (match by `document_name ILIKE`).
2. For each Pattern A sheet, compare classifier `header_row_index` against what the current `isLikelyColumnHeaderRow` heuristic would find on the saved rows.
3. Post the result table (below) as a chat reply, **not** as a PR.
4. **If any MISMATCH row appears on a regression file → stop, surface to user, await direction. Do not start implementation.**
5. If all rows match → proceed to Stage B.

Audit output table:

| File | Sheet | classifier `header_row_index` | heuristic finds | Match? | classifier `section_marker_pattern` | classifier `implied_levels` |
|---|---|---|---|---|---|---|

Operational Plan's `implied_levels` from this same audit also satisfies §4's verification — no separate TODO.

**Stage B — Implementation PR. Only opened after Stage A passes.**

Single PR, files listed in §9.

---

## 1. Code paths to change (Stage B)

### `src/utils/spreadsheet-parser.ts`

New local type (not exported through `types/plan.ts`):
```ts
export interface ClassifierStructureHint {
  pattern?: string | null;
  header_row_index?: number | null;
  data_starts_at_row?: number | null;
  section_marker_pattern?: string | null;
  implied_levels?: string[];
}
```

Signature changes (both new params optional):
```ts
export function detectStructure(
  sheets: ParsedSheet[],
  classifierHints?: Record<string, ClassifierStructureHint>,
  sessionId?: string,
): StructureDetection

function detectGenericPattern(
  sheet: ParsedSheet,
  rows: (string | number | null)[][],
  avgCols: number,
  hint?: ClassifierStructureHint,
  sessionId?: string,
): SheetDetection
```

Body of `detectGenericPattern`:
1. `useClassifier = hint?.pattern === 'A' && typeof hint.header_row_index === 'number' && typeof hint.data_starts_at_row === 'number'`.
2. If `useClassifier` → `detectGenericFromClassifier(sheet, rows, hint)`.
3. Else → existing heuristic body, completely unchanged.
4. Fire `logParserDiagnostic(sessionId, 'ssphase4c1', ...)` with route + section summary.

`detectGenericFromClassifier`:
- Column headers from `rows[hint.header_row_index]`, used globally for all sections.
- Walk rows from `hint.data_starts_at_row`. Section marker iff `hint.section_marker_pattern` non-null AND its first non-empty cell matches that regex. If `null`, treat region as one section.
- Per section: `headerText` = marker row first non-empty cell; `dataRowStart` = marker row + 1 (or `data_starts_at_row` for first); `dataRowEnd` = next marker (or last non-empty); `sectionType: 'generic'`.
- Returns same `SheetDetection` shape — no field additions.

No change to `detectStrategyPattern`, `mergeSheetDetections`, `getDefaultColumnRole`, `generatePlanItems`, `COLUMN_PATTERNS`.

### `src/components/steps/SpreadsheetImportStep.tsx`

Single-fetch dedup via `useRef`:
- `classificationRef = useRef<{ promise: Promise<LayoutClassification | null> } | null>(null)`.
- `getClassification()` lazily populates the ref with one Supabase query; subsequent calls return the cached promise.
- Mount `useEffect` (line 188): `await getClassification()` → build `Record<sheetName, ClassifierStructureHint>` → `detectStructure(sheets, hints, sessionId)`.
- `tryDispatchHierarchical` (line ~410): replace inline `.from('processing_sessions').select('layout_classification')` with `await getClassification()`. **Net query count: 1 per session, same as today.**

If fetch fails / null → hints undefined → heuristic path. Matches today exactly.

### `src/components/steps/SheetPickerStep.tsx`

**Pinned out of scope — not touched.** Picker continues to use heuristic counts. If post-deploy users notice picker/importer count divergence on Pattern A, that becomes a separate backlog item.

---

## 2. Plumbing path

```text
processing_sessions.layout_classification (DB)
        │
        ▼
getClassification() in SpreadsheetImportStep (ref-cached, single fetch)
        │
        ├─→ mount useEffect → build hints map → detectStructure(sheets, hints, sessionId)
        │                                              │
        │                                              ▼
        │                                       detectGenericPattern(..., hint, sessionId)
        │                                              │
        │                                              ├── classifier path
        │                                              └── heuristic path
        │
        └─→ tryDispatchHierarchical (reuses cached promise)
```

---

## 3. Fallback logic

Heuristic path runs when ANY of:
- `hint` undefined
- `hint.pattern !== 'A'`
- `hint.header_row_index` not a number
- `hint.data_starts_at_row` not a number
- Sheet name missing from hints map
- `layout_classification.error` set / null

`section_marker_pattern === null` → still classifier path (single-region Pattern A).

---

## 4. `implied_levels` for Pattern A items

Not added to `DetectedSection`. Already consumed by `SpreadsheetImportStep.tsx:577` (level state seed) and `:1346` (level-name fallback). After 4c.1, `PlanItem.levelName` continues to derive from `levels[depth].name` chosen in `MappingConfirmation` — same code path as today.

Operational Plan `implied_levels` verified during Stage A audit — not a deferred TODO.

---

## 5. Regression risk per file

| File | Pattern | After 4c.1 | Item count change | Level-name change |
|---|---|---|---|---|
| Operational Plan (~685) | A | classifier (pending Stage A) | None expected | None |
| Initiative 1 (24) | A | classifier | None expected | None |
| Astera (20-sheet) | mixed | A → classifier; B/C unchanged | None expected | None |
| Tulane (169) | B | unchanged | None | None |
| Santa Cruz (729 / 826) | B | unchanged | None | None |
| Carmen (14 / 17) | A | classifier | None expected | None |

Mitigation is **preventive** (Stage A audit) **+ reactive** (post-merge diagnostics).

---

## 6. Diagnostics

`logParserDiagnostic(sessionId, 'ssphase4c1', logType, payload)`:
- `log_type: 'route'` per sheet → `{ path, reason, headerRowIndex, dataStartsAtRow, sectionMarkerPattern, impliedLevelsCount }`
- `log_type: 'sections'` per sheet → `{ path, sectionCount, totalDataRows, sectionsPreview: sections.slice(0,5) }`

---

## 7. Strict-scope confirmation

Will NOT touch: `parseHierarchicalColumns.ts`, `applyRowPredicate.ts`, `applyCellTransformations.ts`, `types/plan.ts`, `classify-spreadsheet-layout/index.ts`, `MappingInterface`, `LevelMappingInterface`, `MappingConfirmation`, `FileUploadStep`, `SheetPickerStep`, `getDefaultColumnRole`, `COLUMN_PATTERNS`, `generatePlanItems`, `tryDispatchHierarchical` branching, no new phases.

---

## 8. Testing approach

**Stage A — audit only.** Query results posted as chat checkpoint.

**Stage B pre-deploy (locally on Lovable preview):**

1. Add `src/utils/spreadsheet-parser.test.ts` (Vitest) and `src/utils/__fixtures__/ssphase4c1/` directory containing:
   - `operational-plan.classification.json` — copied verbatim from a real `processing_sessions.layout_classification` row's `sheets[].structure` block (Operational Plan or whichever Stage A confirmed).
   - `carmen.rows.json` (or `initiative1.rows.json`) — a real parsed sheet (`ParsedSheet.rows`) from a small regression file, pulled from a session's source file via the existing parser. Pick the smallest viable so the fixture file stays manageable.
   - `carmen.classification.json` — that same file's real classifier `structure` block.
   
   Fixtures are checked into the repo as static JSON. No hand-rolled hints, no synthetic rows.

2. Tests:
   - **Heuristic-path regression**: `detectStructure([carmenSheet])` with no hints → snapshot `totalDataRows` and section bounds. Locks current behavior.
   - **Classifier-path parity**: `detectStructure([carmenSheet], { [name]: carmenClassification })` → asserts `totalDataRows` equals the heuristic-path snapshot (zero-delta contract). Asserts section count + per-section row counts.
   - **Operational Plan classifier-path smoke**: same parity assertion using the larger fixture if file size permits; otherwise just assert structure shape and section count match Stage A audit findings.
   - **Fallback — wrong pattern**: hint with `pattern: 'B'` → heuristic path taken (verify via `parser_diagnostics` mock or by comparing output to no-hint case).
   - **Fallback — null header**: hint with `header_row_index: null` → heuristic path.

3. `bunx vitest run src/utils/spreadsheet-parser.test.ts` locally before pushing.

**Stage B post-deploy on preview URL:**

4. Manually upload all six regression files. Confirm exact item-count match against documented baseline. Inspect `parser_diagnostics` `ssphase4c1` rows: classifier path fired on Pattern A files; `totalDataRows` matches baseline.

Phase closes only after all six counts match.

---

## 9. Ship plan

Stage A → chat checkpoint (no PR).
Stage B → single PR, files edited:
- `src/utils/spreadsheet-parser.ts`
- `src/components/steps/SpreadsheetImportStep.tsx`
- `src/utils/spreadsheet-parser.test.ts` (new)
- `src/utils/__fixtures__/ssphase4c1/*.json` (new, real data)

Not edited: `SheetPickerStep.tsx` and everything else in §7.
