

# Fix: Increase PDF Page Rendering Limit from 20 to 100

## Problem
The `renderPDFToImages` function defaults to 20 pages max, and the caller in `FileUploadStep.tsx` explicitly passes `20`. A 40-page document has its second half silently dropped — no agent ever sees those pages.

## Changes

### File 1: `src/utils/pdfToImages.ts`
Change the default `maxPages` parameter from `20` to `100` (line 26).

### File 2: `src/components/steps/FileUploadStep.tsx`
Change the call at line 255 from `renderPDFToImages(file, 20, 0.75, pageRange)` to `renderPDFToImages(file, 100, 0.75, pageRange)`.

## Note on Issue 2
The priority misassignment on dense two-column summary pages is an AI accuracy issue, not a code bug. Increasing the page cap will naturally help because the extractor will have access to the dedicated detail pages with clearer formatting.

| File | Change |
|------|--------|
| `src/utils/pdfToImages.ts` | Default `maxPages` from 20 → 100 |
| `src/components/steps/FileUploadStep.tsx` | Caller passes 100 instead of 20 |

