

# Fix: Re-advancing from Upload Plan step after Back navigation

## Root Cause

Two separate issues depending on import path:

**PDF path**: `extractedItems`, `fileContent`, and `detectedLevels` are all lifted state and persist across navigation. The Continue button (`disabled={(!fileContent.trim() && !extractedItems) || isLoading}`) should remain enabled. However, `handleContinue` calls `onAIExtraction` which re-opens the Level Verification modal — this works but is slightly redundant.

**Spreadsheet path** (likely the actual bug): `spreadsheetFile` is **local state** (line 63), not lifted. When the user navigates away and back, it resets to `null`. The component then renders the main upload UI instead of `SpreadsheetImportStep`. The file status shows "Document processed" (because `uploadedFile` is lifted), but `extractedItems` is `null` and `fileContent` is empty (spreadsheet flow never sets these) → **Continue button is disabled**.

## Fix — `src/components/steps/FileUploadStep.tsx`

1. **Add an `alreadyProcessed` prop** (or similar boolean) passed from Index.tsx indicating that `state.items.length > 0` — meaning this step was already completed.

2. **Alternative simpler approach**: Add a `onContinueWithExisting` callback prop. In `FileUploadStep`, if `uploadedFile` is set and `extractedItems` is null and the parent already has items, show a "Continue with existing data" button that skips re-processing.

**Simplest approach (preferred)**: Lift `spreadsheetFile` to Index.tsx like all other file state, so the spreadsheet UI re-renders correctly on Back navigation. But this still won't help since the spreadsheet `onComplete` flow skips `extractedItems` entirely.

**Actual simplest fix**: Change the Continue button logic to also accept a new prop `hasExistingItems: boolean`. When true and `uploadedFile` is set, the button is enabled and calls a simple advance callback instead of re-triggering extraction.

## Changes

### `src/components/steps/FileUploadStep.tsx`
- Add prop `hasExistingItems?: boolean` and `onAdvanceExisting?: () => void`
- Update button disabled logic: `disabled={(!fileContent.trim() && !extractedItems && !hasExistingItems) || isLoading}`
- In `handleContinue`, if `hasExistingItems` and no `extractedItems`, call `onAdvanceExisting()` to skip re-extraction and advance directly

### `src/pages/Index.tsx`
- Pass `hasExistingItems={state.items.length > 0}` to `FileUploadStep`
- Pass `onAdvanceExisting` callback that advances to step 2 or 3 (depending on whether people mappings exist), skipping the level modal since levels are already confirmed

## Files

| File | Change |
|------|--------|
| `src/components/steps/FileUploadStep.tsx` | Add `hasExistingItems` prop, update disabled logic and handleContinue |
| `src/pages/Index.tsx` | Pass `hasExistingItems` and `onAdvanceExisting` props |

