# Phase 4a fix: producer/consumer wiring for the sheet picker

## Root cause (confirmed)

The picker is the *consumer* of `processing_sessions.layout_classification`, but the *producer* (the `classify-spreadsheet-layout` invoke) currently lives in `SpreadsheetImportStep.tsx`, which only mounts after the user clicks Continue past the picker. So when the picker mounts and polls, no classifier call has been made for the session — the column stays null until the picker's 60s timeout fires "AI analysis unavailable". The classifier only runs once the user clicks through, which is why the admin Layout Classification panel later shows perfect JSON for the same session.

## sessionId availability check (the question you asked)

Verified in `src/pages/Index.tsx`: `sessionId` is created upstream by `ensureSessionId` and passed into `FileUploadStep` as a prop before the upload screen mounts. The existing render guard for the picker — `if (spreadsheetFile && sessionId && onSpreadsheetComplete)` at `FileUploadStep.tsx:1022` — already proves `sessionId` is populated by the time we set `spreadsheetFile`. So **resolution #1 applies**: fire the invoke right at `setSpreadsheetFile(file)`. No need to chain off `ensureSessionId`.

## Changes

### 1. `src/components/steps/FileUploadStep.tsx`

In the spreadsheet branch around line 888–892 (`else if (isExcel || fileName.endsWith('.csv'))`), before `setSpreadsheetFile(file)`:

- Parse the workbook locally with `parseSpreadsheetFile(file)`.
- Build the same `workbookPreview` payload the importer uses today: `{ sheetName, rows: rows.slice(0, 30).map(r => r.slice(0, 12)) }` per sheet (constants `PREVIEW_MAX_ROWS = 30`, `PREVIEW_MAX_COLS = 12`).
- Fire-and-forget `supabase.functions.invoke('classify-spreadsheet-layout', { body: { sessionId, orgName: orgProfile?.organizationName, documentHints: orgProfile?.documentHints, workbookPreview } })`. No await. Log warnings on `error` / `.catch` exactly like today.
- Guard with a `useRef<Set<string>>` keyed by `sessionId` so it only fires once per session even if React strict-mode double-invokes.
- Wrap in try/catch so any parse failure here does not block setting `spreadsheetFile` — the picker's existing fallback ("AI analysis unavailable", select-all) will still apply.

Then call `setSpreadsheetFile(file)` as today.

### 2. `src/components/steps/SpreadsheetImportStep.tsx`

Remove the entire fire-and-forget invoke block at lines 55–72 (the `try { … invoke('classify-spreadsheet-layout', …) … } catch (clsErr) { … }` section). Keep everything else — `parseSpreadsheetFile`, `detectStructure`, `getDefaultSheetSelection`, the `preselectedSheetIndices` handling, and the phase transition — unchanged.

This makes the upstream invoke in `FileUploadStep` the single producer. No double-billing.

### 3. Picker (`SheetPickerStep.tsx`) — no changes

Polling logic, "Analyzing workbook structure…" mount-time state, 60s timeout, fallback UI, pre-selection logic, directives panel — all stay as written. With the producer moved upstream, the column will populate within ~10–30s of picker mount on a typical workbook (well inside the 60s window).

## Out of scope

- Classifier edge function (schema, prompt, merge) — untouched, working correctly.
- Picker UI behavior — untouched.
- Wizard routing — untouched.
- PDF / Word / text / paste paths — untouched.
- Pattern parsers (4b/4c), mapping redesign (4d), Pattern D dead-end (4e) — still deferred.

## Self-test before handoff

Upload `8 - RHT DRAFT_State_Reporting_Template.xlsx` with note "skip use of funds" on a fresh session and confirm:

1. Console shows the classifier invoke firing at file-accept time, not after picker confirm.
2. Picker renders the "Analyzing workbook structure…" state immediately, then transitions to the success view within ~30s.
3. Sheets are grouped by pattern, with the 3 plan-content sheets pre-checked and the 3 `not_plan_content` sheets unchecked.
4. The "Suggestions from your notes" panel surfaces with `Use of Funds` listed under "Sheets you asked to skip", default = Ignore.
5. Admin Layout Classification panel shows exactly one classifier run for that session (no duplicate).

Report back with a screenshot of the picker rendering the success state for re-validation.

## Files touched

- `src/components/steps/FileUploadStep.tsx` — add upstream classifier invoke at file-accept.
- `src/components/steps/SpreadsheetImportStep.tsx` — remove duplicate invoke block.
