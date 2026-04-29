## Plan: Phase 2 — Add Screen 2 to the Excel/CSV flow

Today the spreadsheet path skips Screen 2 entirely: Screen 1 → straight to processing (which renders the mapping UI). This change inserts the existing `ScanResultsStep` between them, reusing all the PDF-path components (no fork). After Continue, routing falls through to today's mapping UI unchanged.

### Note on persistence column

Prompt 20 says "Persist `additional_notes` on `processing_sessions` (confirmed in Phase 1 to live there)." The column added in Phase 1 is actually named **`document_hints`** (text). It already exists, is already populated by `handleStartProcessing` via `setOrgProfile({ ...config.orgProfile, documentHints: notes })`, and is already persisted by the PDF orchestrator. For the spreadsheet path we'll write the same `document_hints` column directly from the client when the spreadsheet completion writes the session row — so notes survive even though no edge function runs. No new migration needed.

### Changes

**1. `src/components/steps/UploadIdentifyStep.tsx`** — stop short-circuiting spreadsheets.

Remove the spreadsheet-specific early-return branch (lines ~196–224) that runs only `lookup-organization` and returns. Spreadsheets will fall through to a unified path:
- Run `lookup-organization` (same as today).
- Skip `classify-document` (no page images for .xlsx/.csv).
- Return `QuickScanResults` with `isSpreadsheet: true`, `pageCount: null`, `classificationResult: null`, `pageImages: null`.

This means spreadsheets reach `handleQuickScanComplete` with the same shape — but `isSpreadsheet` is true.

**2. `src/pages/Index.tsx`** — route spreadsheets through Screen 2.

In `handleQuickScanComplete` (lines 404–411), remove the `isSpreadsheet` branch that calls `advanceToStep(2)`. Always `advanceToStep(1)` so both PDF and spreadsheet paths land on `ScanResultsStep`.

`ScanResultsStep` already handles a null `pageCount` and null `classificationResult` gracefully:
- The Document Scope card is wrapped in `{pageCount !== null && (...)}` — it simply won't render for spreadsheets.
- The Time Estimate is wrapped in `{timeEstimate && ...}` — won't render either.
- Plan Structure card and Additional Notes card both render unconditionally.
- Org match card renders when `lookupResult` is non-null.

Result: spreadsheet users see Org confirmation + Plan Structure (no-op for now, with no copy change per prompt) + Additional Notes. They click Start Processing → `handleStartProcessing` runs → `advanceToStep(2)` → `FileUploadStep` mounts → spreadsheet branch in there routes to mapping UI as today.

**3. `src/components/steps/SpreadsheetImportStep.tsx`** — persist `document_hints`.

In `handleApplyMapping`, the `.update({...})` call that marks the session completed currently writes `extraction_method`, `total_items_extracted`, `status`, `document_type`, `step_results`. Add one field:

```ts
document_hints: orgProfile?.documentHints || null,
```

This requires threading `orgProfile` (or just the hints string) into `SpreadsheetImportStep` props. Simplest: add an optional `documentHints?: string` prop, pass `state.orgProfile?.documentHints` from wherever `SpreadsheetImportStep` is rendered (likely `FileUploadStep`).

**4. `src/components/steps/FileUploadStep.tsx`** — pass hints through.

Forward `orgProfile.documentHints` to `SpreadsheetImportStep` so it can persist them.

### What does NOT change

- `WizardProgress` — already generic; the indicator will naturally show the new path because spreadsheets now visit step index 1 just like PDFs.
- The mapping UI (`DetectionSummary`, `MappingInterface`) — untouched (Phase 4 territory).
- The PDF path — untouched.
- AI agents — untouched (notes are collected but not used on the spreadsheet path; Phase 3 will wire them in).
- Re-import flow — untouched (it bypasses Screen 1/2 entirely as before).
- No new migration — `document_hints` column already exists from Phase 1.

### Behavioral notes

- For spreadsheets, the org lookup uses **filename + orgName + industry** (which is already what `lookup-organization` receives — it doesn't take the file content). Using sheet content as additional context is technically out of scope of `lookup-organization`'s current interface; sticking with the simpler "use what we already pass" path per the prompt's "If that's complex, just use the filename for now."
- The `Plan Structure` checkbox on Screen 2 will show for spreadsheets but, as noted in the prompt, has no effect on the spreadsheet path today. The user can still set it; it's stored on `orgProfile.planLevels` and passed through to `setLevels` in `handleStartProcessing`. The spreadsheet mapper currently overrides levels based on detected pattern, so user-defined levels may get replaced. That mismatch is acknowledged by the prompt as Phase 3+ work — not addressed here.

### Regression gates (to run after implementation)

1. **PDF flow (Chattanooga)** — Screen 1 → Screen 2 → Process → Map People → Review & Export still works.
2. **Spreadsheet flow** — upload .xlsx, land on Screen 2 with org card + Notes field, click Continue, reach mapping UI.
3. **`document_hints` persisted** — type something into Notes on Screen 2 for a spreadsheet upload; after mapping completes, verify `processing_sessions.document_hints` contains the text.
4. **Operational Plan .xlsx (685 items)** — full flow still produces 685 items.
5. **DRAFT Initiative 1 tab** — full flow still produces 24 items.
6. **Re-import (PDF)** — bypasses Screen 2 as before.

### Files changed

- `src/components/steps/UploadIdentifyStep.tsx` — remove spreadsheet early-return
- `src/pages/Index.tsx` — remove spreadsheet branch in `handleQuickScanComplete`
- `src/components/steps/SpreadsheetImportStep.tsx` — accept `documentHints` prop, persist on completion
- `src/components/steps/FileUploadStep.tsx` — forward `documentHints` to `SpreadsheetImportStep`
