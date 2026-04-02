

# Screen 1: Upload & Identify — Implementation Plan

## Summary

Create `UploadIdentifyStep` combining org name, industry, and file upload. On Continue, run parallel quick scan (org lookup + parse-pdf + classify-document). After scan completes, advance to Step 1 where FileUploadStep acts as a temporary bridge, receiving pre-loaded state and skipping straight to "ready to process."

## Files

| File | Change |
|------|--------|
| `src/components/steps/UploadIdentifyStep.tsx` | **Create** — new Screen 1 component |
| `src/pages/Index.tsx` | Update wizard steps, add state, wire new transitions |
| `src/components/steps/FileUploadStep.tsx` | Add `pageImages` prop, use pre-rendered images in vision pipeline instead of re-rendering |

## 1. New: `UploadIdentifyStep.tsx`

**Card 1 — Organization Details:**
- Org name text input (required), placeholder "e.g., City of Austin"
- Industry dropdown (required) — reuse `INDUSTRIES` array from OrgProfileStep

**Card 2 — Upload Your Strategic Plan:**
- Drag-and-drop zone matching current FileUploadStep styling
- File type badges: PDF, Word, Excel, CSV, Text
- After file selected: show file name, size, page count (for PDFs, read via `pdfjsLib.getDocument()` client-side — just `pdf.numPages`), Remove button

**Continue button:** Enabled when orgName + industry + file all provided.

**On Continue — Parallel Quick Scan:**
- Show scanning overlay (semi-transparent over the step, not a new wizard step)
- Overlay: "Analyzing your document…" with spinner + status lines updating as each op completes
- For PDFs, run via `Promise.allSettled`:
  1. `lookup-organization` edge function
  2. `parse-pdf` edge function → store `parsedText`, `pageCount`
  3. `renderPDFToImages()` client-side → `classify-document` edge function → store `classificationResult`, `pageImages`
- For spreadsheets: org lookup only, then advance
- For text files: read content client-side, org lookup only, then advance
- Page count >250 check: show error inline on overlay, don't advance
- All failures are non-blocking (stored as errors) — still advance to next step

**Props:**
```typescript
interface UploadIdentifyStepProps {
  onComplete: (results: QuickScanResults) => void;
  ensureSessionId: () => Promise<string>;
  sessionId?: string;
  orgName: string; setOrgName: (v: string) => void;
  industry: string; setIndustry: (v: string) => void;
  uploadedFile: File | null; setUploadedFile: (v: File | null) => void;
}

interface QuickScanResults {
  lookupResult: LookupResult | null;
  parsedText: string | null;
  pageCount: number | null;
  classificationResult: Record<string, unknown> | null;
  pageImages: string[] | null;
  scanErrors: Record<string, string>;
}
```

## 2. Modify: `Index.tsx`

**Updated WIZARD_STEPS:**
```typescript
const WIZARD_STEPS = [
  { id: 'upload-identify', title: 'Upload & Identify' },
  { id: 'configure', title: 'Configure' },
  { id: 'processing', title: 'Processing' },
  { id: 'review', title: 'Review & Export' },
];
```

**New state variables:**
```typescript
const [classificationResult, setClassificationResult] = useState<Record<string, unknown> | null>(null);
const [parsedText, setParsedText] = useState<string | null>(null);
const [documentPageCount, setDocumentPageCount] = useState<number | null>(null);
const [pageImages, setPageImages] = useState<string[] | null>(null);
const [scanErrors, setScanErrors] = useState<Record<string, string>>({});
```

**New handler — `handleQuickScanComplete`:**
- Receives `QuickScanResults` from UploadIdentifyStep
- Stores all results in state
- Builds `orgProfile` from orgName + industry + lookupResult
- Sets `fileContent` from `parsedText` (so FileUploadStep sees text ready)
- Sets `uploadedFile` (already set via lifted state)
- Advances to step 1

**Step routing:**
- Step 0 → `UploadIdentifyStep`
- Step 1 → `FileUploadStep` (temporary bridge — sees `uploadedFile` + `fileContent` pre-populated)
- Step 2 → `PeopleMapperStep`
- Step 3 → `PlanOptimizerStep`

**handleStartOver:** Reset all new state variables.

## 3. Modify: `FileUploadStep.tsx` — Bridge Behavior

**The bridge works because:**
- `uploadedFile` is already lifted state — when pre-set, line 897 (`!uploadedFile`) is false, so the drop zone is skipped
- `fileContent` is already lifted state — when pre-set with parsedText, the Continue button is enabled (line 1090: `!fileContent.trim()` is false)
- The component renders the file status bar + Continue button immediately, no extraction running

**Add `pageImages` as optional lifted state prop:**
```typescript
// Add to props interface:
pageImages: string[] | null; setPageImages: (v: string[] | null) => void;
```

In `extractWithVisionPipeline` (line 413), check if `pageImages` are already available before re-rendering:
```typescript
let images: { dataUrl: string }[];
let pageCount: number;
if (pageImages && pageImages.length > 0) {
  images = pageImages.map(url => ({ dataUrl: url }));
  pageCount = pageImages.length;
} else {
  const rendered = await renderPDFToImages(file, 250, 0.75, pageRange);
  images = rendered.images;
  pageCount = rendered.pageCount;
  setPageImages(images.map(i => i.dataUrl));
}
```

This avoids re-rendering PDFs that were already rendered during the quick scan.

**Key point:** When the user lands on FileUploadStep via the bridge, they see the file status bar showing "Document processed" and a Continue button saying "Continue to Level Verification" (or "Continue with N Items" if extraction already ran). They click Continue, which triggers `handleContinue` → either `onAIExtraction` (if items exist) or kicks off extraction. The existing flow from that point is unchanged.

**No other changes to FileUploadStep** — it doesn't need to know about the bridge. The lifted state props handle everything.

## What stays unchanged

- All edge functions
- ProcessingOverlay, polling logic, stall detection
- LevelVerificationModal
- PeopleMapperStep, PlanOptimizerStep
- SpreadsheetImportStep
- OrgProfileStep (kept, just not rendered at step 0 anymore)

