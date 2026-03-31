

# Fix Spreadsheet Import: Levels, Hierarchy, Member, Multi-Sheet

## Overview
Three changes to the spreadsheet import: (1) detect Strategy/Outcome/Action/Measurement hierarchy pattern, (2) add "Member" column mapping, (3) multi-sheet selection with merge and dedup.

## Changes

### 1. `src/utils/spreadsheet-parser.ts` — Major rewrite of detection + generation

**Types**:
- Add `ColumnRole` value `'member'`
- Add `OutcomeRow` type to `DetectedSection`: `{ rowIndex: number; text: string }`
- Add `sectionType: 'strategy' | 'outcome' | 'generic'` to `DetectedSection`
- Add `MappingConfig.measurementMode: 'level4' | 'metric_on_parent'` to control how Outcome/Measurement column is handled
- Update `MappingConfig` to accept `selectedSheetIndices: number[]` (array) instead of single index

**Detection (`detectStructure`)**:
- New helper `isStrategyRow(row)`: checks if cell A starts with "Strategy:" (case-insensitive)
- New helper `isOutcomeRow(row)`: checks if cell A starts with "Outcomes" (case-insensitive)
- Detection loop: when a Strategy row is found, look for an Outcome row immediately after, then a column header row, then data rows. Store the outcome text and strategy text on the `DetectedSection`.
- Fallback: if no "Strategy:" rows found, use existing generic detection (backwards compatible with other spreadsheets)

**Column defaults (`getDefaultColumnRole`)**:
- Add pattern: `/department|member|team/i` → `'member'` (instead of `'tag'`)
- Keep existing patterns, just change department from `'tag'` to `'member'`

**Generation (`generatePlanItems`)**:
- Accept `SheetDetection[]` (array) instead of single `SheetDetection` for multi-sheet
- For each section with `sectionType === 'strategy'`:
  - Create Level 1 item (Strategy) — name from "Strategy:" text
  - Create Level 2 item (Outcome) — name from outcome row text, parent = strategy
  - Each data row → Level 3 item (Action), parent = outcome
  - If `measurementMode === 'level4'` and the Outcome/Measurement column has content → create Level 4 item (Measurement), parent = action
  - If `measurementMode === 'metric_on_parent'` → store as `metricTarget` on the action instead
- Store source sheet name as a tag on each item: `"Source: [SheetName]"`
- Cross-sheet dedup: name+parent key, keep first occurrence
- Add `findColumnByRole('member')` → store value in `item.members` array
- New export: `mergeSheetDetections(detections: SheetDetection[]): SheetDetection` that concatenates sections from multiple sheets, used when multiple sheets selected

**Default levels**: When strategy pattern detected, set levels to:
```
Level 1: Strategy, Level 2: Outcome, Level 3: Action, Level 4: Measurement
```

### 2. `src/components/spreadsheet/DetectionSummary.tsx` — Multi-sheet checklist

- Replace `selectedSheetIndex: number` / `onSelectSheet` with `selectedSheetIndices: number[]` / `onSelectSheets`
- Replace the single `<Select>` dropdown with a list of checkboxes (one per sheet): checkbox + sheet name + "(N items)"
- Add "Select All" / "Deselect All" buttons
- Default selection logic:
  - If any sheet name matches `/enterprise|all\s|summary|consolidated/i` → select only that sheet
  - Otherwise → select all sheets
- Summary text: "Importing X sheet(s) with Y total items across Z sections"
- "Continue to Mapping" disabled if no sheets selected

### 3. `src/components/spreadsheet/MappingInterface.tsx` — Member + Measurement mode

- Add `'member'` to `COLUMN_ROLE_OPTIONS`: `{ value: 'member', label: 'Member' }`
- Add `measurementMode` state: `'level4' | 'metric_on_parent'`, default `'level4'`
- When a column is mapped to `'metric'` and strategy pattern is detected, show a sub-option: "Create as Level 4 (Measurement)" vs "Store as metric on parent Action"
- Pass `measurementMode` through `MappingConfig` to `onApply`
- Update level names in dropdowns to show Strategy/Outcome/Action/Measurement when that pattern is detected
- Accept `SheetDetection[]` (merged from selected sheets) instead of single `SheetDetection`

### 4. `src/components/steps/SpreadsheetImportStep.tsx` — Thread multi-sheet

- Replace `selectedSheetIndex` state with `selectedSheetIndices: number[]`
- On parse complete, apply default selection logic (enterprise sheet or all)
- Set default column mappings from the first selected sheet
- When strategy pattern detected, set `levels` to 4-level Strategy/Outcome/Action/Measurement
- On "Apply Mapping": merge selected `SheetDetection`s, call `generatePlanItems` with the merged detection
- Update session tracking: `sheetsProcessed: selectedSheetIndices.length`

### 5. `src/types/plan.ts` — No changes needed
`PlanItem.members` already exists as `string[]`.

## Files Summary

| File | Change |
|------|--------|
| `src/utils/spreadsheet-parser.ts` | Strategy/Outcome detection, multi-sheet merge, member role, measurement mode |
| `src/components/spreadsheet/DetectionSummary.tsx` | Multi-sheet checklist with Select All/Deselect All |
| `src/components/spreadsheet/MappingInterface.tsx` | Add Member option, measurement mode toggle |
| `src/components/steps/SpreadsheetImportStep.tsx` | Multi-sheet selection state, 4-level defaults |

## What does NOT change
- No PDF pipeline, edge functions, or agents
- No FileUploadStep routing or Index.tsx handlers
- No PlanOptimizerStep or admin panel
- No export logic (members column already exported via `item.members.join(', ')`)

