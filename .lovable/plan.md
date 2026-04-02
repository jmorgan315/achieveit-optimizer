

# Fix: handleContinue does nothing when only uploadedFile is present

## Problem
`handleContinue` has three conditional branches, all requiring either `extractedItems`, `hasExistingItems`, or `fileContent` to be populated. When the user arrives from Screen 1 with only `uploadedFile` set (parse-pdf was skipped or failed), no branch matches and the click is silently ignored.

## Solution
Add a fourth branch: when `uploadedFile` is present but no text/items exist yet, trigger the extraction pipeline (the same `handleFileUpload` flow that normally runs after a file is selected on this screen).

### File: `src/components/steps/FileUploadStep.tsx`

**Change `handleContinue`** (lines 844–852) to add a fallback branch:

```typescript
const handleContinue = () => {
  if (extractedItems && extractedMappings && detectedLevels && onAIExtraction) {
    onAIExtraction(extractedItems, extractedMappings, detectedLevels);
  } else if (hasExistingItems && onAdvanceExisting) {
    onAdvanceExisting();
  } else if (fileContent.trim() && fileContent !== '__VISION_EXTRACTED__') {
    onTextSubmit(fileContent);
  } else if (uploadedFile) {
    // File present but no extracted content yet — run the extraction pipeline
    handleFileUpload(uploadedFile);
  }
};
```

This reuses the existing `handleFileUpload` function which already handles PDF parsing, vision fallback, spreadsheet detection, and all error states. No other changes needed.

### What stays the same
- Button disabled condition (already updated)
- All existing branches unchanged
- `handleFileUpload` logic unchanged
- No new state or props

