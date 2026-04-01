

# Raise page limit to 250 and add frontend upload blocker

## Changes

### 1. `supabase/functions/parse-pdf/index.ts`
- Line 12: Change `MAX_PAGES = 100` → `MAX_PAGES = 250`

### 2. `src/utils/pdfToImages.ts`
- Line 26: Change default `maxPages: number = 100` → `maxPages: number = 250`

### 3. `src/components/steps/FileUploadStep.tsx`
- Line 375: Change `renderPDFToImages(file, 100, ...)` → `renderPDFToImages(file, 250, ...)`
- Add new state: `const [pageCountError, setPageCountError] = useState<string | null>(null)`
- Add constant: `const MAX_PDF_PAGES = 250`
- After `parsePdfWithEdgeFunction` returns (line 639-643 area), check `textResult.pageCount > MAX_PDF_PAGES` → set `pageCountError` with the message, clear file content, abort processing, return early
- For the vision-only path (large files that skip text extraction), check page count from `renderPDFToImages` result → same blocker
- In `clearFile`, also clear `pageCountError`
- Add blocker UI: between the file status bar and the processing overlay (around line 912), render an error banner when `pageCountError` is set:
  - Red alert with AlertTriangle icon
  - Message: "This document has [X] pages. The current limit is 250 pages. Try uploading only the section that contains your strategic plan, or use Document Scope to narrow the page range."
- Update Continue button disabled logic (line 1026): add `|| !!pageCountError` to the disabled condition
- The blocker only fires for PDF uploads — Excel/CSV path is unaffected

## Files

| File | Change |
|------|--------|
| `supabase/functions/parse-pdf/index.ts` | `MAX_PAGES` 100 → 250 |
| `src/utils/pdfToImages.ts` | Default `maxPages` 100 → 250 |
| `src/components/steps/FileUploadStep.tsx` | Add page count check, blocker UI, disable Continue when blocked |

