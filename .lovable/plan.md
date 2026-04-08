

## Bug: Page Range Not Applied — Root Cause Analysis

### The Data Flow (with the break point)

```text
Screen 2 (ScanResultsStep)          →  ProcessingConfig.pageRanges = [{start:61, end:63}]
                                        ProcessingConfig.orgProfile.pageRange = UNDEFINED ← ❌
                                        
Index.tsx handleStartProcessing()   →  setOrgProfile(config.orgProfile)  ← pageRange is missing
                                        config.pageRanges is IGNORED, never mapped anywhere

FileUploadStep                      →  orgProfile.pageRange = undefined
                                        Sends ALL pre-rendered images to process-plan
                                        pageRange field in request body = undefined

process-plan edge function          →  pageRange = undefined
                                        Falls back to Agent 0's page_annotations filtering
                                        Processes whatever Agent 0 recommends (often most pages)
```

### Where It Breaks

**Break Point 1 — `ScanResultsStep.tsx` line 198-225**: The `handleStartProcessing` function builds the `OrgProfile` object but **never sets `pageRange`** on it. The parsed page ranges are put into `ProcessingConfig.pageRanges` (an array of `{start, end}` objects), but the `OrgProfile.pageRange` field (which expects `{startPage, endPage}`) is left undefined.

**Break Point 2 — `Index.tsx` line 330-344**: `handleStartProcessing` calls `setOrgProfile(config.orgProfile)` (which has no pageRange) and completely ignores `config.pageRanges`. Nobody ever maps the array of ranges onto the orgProfile.

**Break Point 3 — `FileUploadStep.tsx` line 492-508**: When pre-rendered images exist from quick scan, it uses ALL of them regardless of page range. When rendering fresh, it passes `orgProfile.pageRange` to `renderPDFToImages()` — but that field is undefined, so all pages are rendered.

### Type Mismatch

- `ProcessingConfig.pageRanges`: `Array<{start: number, end: number}> | null` — supports non-contiguous ranges
- `OrgProfile.pageRange`: `{startPage: number, endPage: number}` — only supports a single contiguous range
- `process-plan` edge function: receives `pageRange` as a string like `"61-63"` and parses it

The types are incompatible. The UI supports "1-5, 10, 15-20" but the downstream only accepts one range.

### Fix Plan

#### 1. Change `OrgProfile.pageRange` type in `src/types/plan.ts`
Change from `{startPage, endPage}` to `string` (e.g., `"61-63"` or `"1-5, 10, 15-20"`). This matches what `process-plan` expects and supports non-contiguous ranges.

#### 2. Map pageRanges onto orgProfile in `ScanResultsStep.tsx`
In `handleStartProcessing`, convert the parsed ranges array back to a string and set it on the profile:
```typescript
const profile: OrgProfile = {
  ...existing fields,
  pageRange: scopeInput.trim() || undefined,  // pass the raw string like "61-63"
};
```

#### 3. Filter images in `FileUploadStep.tsx` before sending
When pre-rendered quick-scan images exist, filter them to only include pages within the user's specified range before sending to `process-plan`. Parse the `orgProfile.pageRange` string to determine which page indices to include.

#### 4. Update `renderPDFToImages` call
Update the call in `FileUploadStep.tsx` to handle the new string-based pageRange format when rendering fresh (non-quick-scan path).

### Files to Modify

| File | Change |
|------|--------|
| `src/types/plan.ts` | Change `pageRange` type to `string \| undefined` |
| `src/components/steps/ScanResultsStep.tsx` | Set `pageRange` on orgProfile from scopeInput |
| `src/components/steps/FileUploadStep.tsx` | Filter pre-rendered images by page range before sending |
| `src/utils/pdfToImages.ts` | Update to accept string-based page range (or parse in caller) |

