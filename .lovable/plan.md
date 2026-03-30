

# Excel/CSV Import Path — Revised Plan

## Overview
Parallel client-side import path for spreadsheets. PDF pipeline is untouched. Shares only the final Review & Export step.

## Key Callouts from User Feedback

1. **Level Verification Modal**: The `showLevelModal` is triggered by `handleAIExtraction` (line 175) which sets `setPendingAIData` then `setShowLevelModal(true)`. For spreadsheet imports, we'll add a separate handler (`handleSpreadsheetComplete`) that calls `setLevels` + `setItems` + `advanceToStep(2)` directly — never touching `showLevelModal`. The modal's `open` prop stays wired to `showLevelModal` which only PDF sets. No risk of hiding it for PDF runs.

2. **Multi-sheet**: v1 defaults to the largest/first sheet with a selector to pick one. Note in the UI that multi-sheet merge is planned. Not a blocker.

## Changes

### 1. Install `xlsx` (SheetJS)
Add to `package.json`.

### 2. New: `src/utils/spreadsheet-parser.ts`
- `parseSpreadsheetFile(file)` — reads all sheets via SheetJS, returns sheet names + raw row arrays
- `detectStructure(sheets)` — identifies section headers (rows spanning columns or preceding data blocks), column headers, data rows, repeating sections
- Smart column defaults: "Action"/"Description" → Item Name, "Owner"/"Sponsor" → Owner, "Deadline"/"Date" → Date, "Metric"/"Measurement" → Metric, "Department" → prompt user
- `generatePlanItems(sheets, mapping, levels)` — walks rows per mapping config, builds `PlanItem[]` with hierarchy, confidence 100, source "spreadsheet"
- Simple name+parent dedup

### 3. New: `src/components/spreadsheet/DetectionSummary.tsx`
- "Found X sheets with Y items across Z sections"
- Sheet selector (defaults to largest), shows item counts per sheet
- Note: "Multi-sheet merge coming in a future update"
- "Continue to Mapping" button

### 4. New: `src/components/spreadsheet/MappingInterface.tsx`
- Left panel: detected elements (section headers, columns) with dropdowns (Level 1/2/3/etc., Item Name, Owner, Date, Metric, Tag, Skip)
- Right panel: live preview tree of first 10-15 items with current mapping
- Smart defaults pre-filled
- "Apply Mapping" button

### 5. New: `src/components/steps/SpreadsheetImportStep.tsx`
Orchestrator with internal phases: Detection → Mapping → Generation. On completion, calls parent callback with generated `PlanItem[]`, `PersonMapping[]`, and `PlanLevel[]`.

### 6. Modify: `src/components/steps/FileUploadStep.tsx`
Lines 684-691 only — replace Excel demo fallback:
- Parse file with SheetJS, set `spreadsheetData` state
- When set, render `SpreadsheetImportStep` instead of extraction UI
- On completion, call a new `onSpreadsheetComplete` prop (separate from `onAIExtraction`)

### 7. Modify: `src/pages/Index.tsx`
- Add `handleSpreadsheetComplete(items, personMappings, levels)` handler that:
  - Calls `setLevels(levels)`, `setItems(items, personMappings)` directly
  - Skips `showLevelModal` entirely (never sets it to true)
  - Advances to step 2 (People Mapper) or step 3 (Review) depending on whether mappings exist
- Pass `onSpreadsheetComplete` as prop to `FileUploadStep`
- Add `spreadsheetImportMode` reset in `handleStartOver`
- **No changes to `handleAIExtraction` or `showLevelModal` logic** — PDF path untouched

### 8. Session tracking
In `SpreadsheetImportStep`, upsert `processing_sessions` with `extraction_method: 'spreadsheet'`, `total_items_extracted`, `status: 'completed'`, mapping config in `step_results`.

## Files Summary

| File | Change |
|------|--------|
| `package.json` | Add `xlsx` |
| `src/utils/spreadsheet-parser.ts` | New — parse, detect, generate |
| `src/components/spreadsheet/DetectionSummary.tsx` | New — detection results UI |
| `src/components/spreadsheet/MappingInterface.tsx` | New — mapping UI with live preview |
| `src/components/steps/SpreadsheetImportStep.tsx` | New — orchestrator |
| `src/components/steps/FileUploadStep.tsx` | Replace Excel demo fallback with spreadsheet path |
| `src/pages/Index.tsx` | Add `handleSpreadsheetComplete` handler (separate from PDF's `handleAIExtraction`) |

## What does NOT change
- No edge functions, no PDF pipeline, no polling/resume logic
- No changes to `PlanOptimizerStep`, `LevelVerificationModal`, or admin panel
- `showLevelModal` only triggered by PDF path — spreadsheet path uses a separate handler

