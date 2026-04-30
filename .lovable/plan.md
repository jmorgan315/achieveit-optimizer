# Phase 4a: AI Classifier Schema Extension + Sheet Picker

Ship the classifier schema additions and a new wizard step that lets users confirm which sheets to import, driven by the AI classifier's output. Stop after this sub-phase for user validation in the admin Layout Classification panel before starting 4b.

## What ships

### 1. Classifier schema extension (`supabase/functions/classify-spreadsheet-layout/index.ts`)

Add to `workbook_summary`:
- `clarification_type`: enum `time_versioning | scope_variation | ambiguous_pattern | mixed_patterns | other` — only set when `needs_user_clarification: true`.

Add new top-level field `parser_directives` — **derived strictly from `documentHints`, never from sheet structure**. If `documentHints` is empty or contains no exclusion/scope language, all fields are empty/false.
- `exclude_sheets`: string[] — sheet names the user's notes explicitly say to skip (e.g., "skip the budget tab"). Independent of structural pattern; a sheet can be plan-content structurally and still appear here.
- `exclude_row_predicates`: string[] — human-readable row filters from the user's notes (e.g., "rows where status = Archived").
- `include_only_recent`: boolean — true only when notes explicitly say so ("just the latest version", "current year only"). The classifier may still flag time-versioning structurally via `clarification_type: time_versioning` without setting this.

System prompt update makes the separation explicit:
- Structural classification (per-sheet `pattern`, including `not_plan_content`) is what the AI sees in the data.
- `parser_directives` is what the user told us in prose, parsed into structured form. No directives without hints.

### 2. Multi-chunk merge logic (same file)

When merging summaries across chunks:
- `clarification_type`: pick first non-null; if chunks disagree, fall back to `mixed_patterns`.
- `parser_directives.exclude_sheets`: union across chunks (dedup).
- `parser_directives.exclude_row_predicates`: union across chunks (dedup).
- `parser_directives.include_only_recent`: OR across chunks.
- Preserve existing `primary_pattern` voting and `needs_user_clarification` OR logic.

### 3. New wizard step: `src/components/steps/SheetPickerStep.tsx`

Inserted between `FileUploadStep` and `SpreadsheetImportStep` for spreadsheet uploads only.

Behavior:
- Mounts with "Analyzing workbook structure…" visible immediately (no delay, no blank frame).
- Polls `processing_sessions.layout_classification` every 1.5s until populated or 60s timeout.
- Renders sheets grouped by pattern (A / B / C / D / not_plan_content / empty / unknown) with the AI's per-sheet reasoning visible.
- Pre-checks all sheets whose pattern is A/B/C/D; leaves not_plan_content / empty / unknown unchecked. User can override.
- Shows `parser_directives` as a collapsible "From your notes" panel when any directive is non-empty. Default action = **Ignore**. User must explicitly click "Apply" per directive. No silent filtering. Panel hidden entirely when all directives are empty.
- If `needs_user_clarification` is true, surfaces `clarification_type` + reason as a top info banner.
- If classifier failed (sentinel error in JSON), falls back to existing detection-only flow with a warning banner.
- Continue button passes selected sheet indices forward.

### 4. Wizard wiring

- `FileUploadStep.tsx` already forwards `orgName` and `documentHints`. Route spreadsheet files through `SheetPickerStep` before `SpreadsheetImportStep`.
- `SpreadsheetImportStep.tsx` accepts an optional `preselectedSheetIndices` prop. When provided, skips its own default selection and goes straight to mapping using those sheets. Existing fire-and-forget classifier call stays as a safety net.

### 5. Self-test before handoff

Upload one multi-sheet workbook with explicit notes ("skip the budget tab") and verify in the admin Layout Classification panel:
- `workbook_summary.clarification_type` appears (or is correctly absent when `needs_user_clarification: false`).
- `parser_directives.exclude_sheets` reflects the note, NOT structural classification.
- A second upload of the same workbook with empty notes produces empty `parser_directives` even if a sheet is structurally `not_plan_content`.
- Multi-chunk workbooks (>5 sheets) show merged directives, not just the last chunk's.

## Out of scope for 4a

- Pattern-specific parsers (4b/4c).
- Mapping UI redesign (4d).
- Pattern D dead-end UI (4e).
- Honoring `parser_directives` in the parser — for now they're display-only suggestions.

## Files touched

- `supabase/functions/classify-spreadsheet-layout/index.ts` — schema, prompt, merge logic.
- `src/components/steps/SheetPickerStep.tsx` — new file.
- `src/components/steps/FileUploadStep.tsx` — route spreadsheets through picker.
- `src/components/steps/SpreadsheetImportStep.tsx` — accept preselected indices.
- Wizard router — insert new step in spreadsheet path.

## Sanity check

No hardcoded sheet names, column header strings, or filenames from the Phase 3 validation set will appear in the diff. Logic is pattern- and notes-driven only.

## Validation scenarios for the user to test after 4a ships

1. Single-sheet workbook, no notes → picker shows one sheet pre-checked; no clarification banner; no directives panel.
2. Multi-sheet workbook with one structural lookup tab, no notes → lookup unchecked under "not_plan_content"; `exclude_sheets` is empty (structural ≠ directive).
3. Same workbook + note "skip the budget tab" → `exclude_sheets: ["Budget"]` shown in directives panel as Ignore-by-default suggestion.
4. Time-versioned workbook, no notes → `clarification_type: time_versioning`, banner visible, `include_only_recent: false`.
5. Same workbook + note "just the latest version" → `include_only_recent: true`.
6. Mixed-pattern workbook (OGSM-style) → `clarification_type: mixed_patterns`, sheets grouped by their distinct patterns.
7. Workbook >5 sheets with notes → merged directives in admin panel reflect all chunks.
8. Classifier failure → picker shows warning + falls back gracefully.
