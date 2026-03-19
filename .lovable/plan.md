

# Fix Vision Extraction for Large/Tabular PDFs

## Root Cause
All page images are sent in one JSON request to `process-plan`, which then batches them for `extract-plan-vision`. A 9-page tabular PDF at scale 1.0 can produce a total payload exceeding the edge function body size limit (~6MB), causing a silent HTTP error before any logging occurs.

## Changes

### 1. Reduce image rendering resolution (`src/utils/pdfToImages.ts`)
- Lower default scale from `1.0` to `0.75` — sufficient for reading table text while significantly reducing image size
- Lower JPEG quality from `0.6` to `0.5` — minimal visual impact for text/table content
- Add a `maxDimension` cap: if either width or height exceeds 1600px after scaling, re-scale down proportionally
- This alone should reduce per-image size from ~1-3MB to ~300KB-800KB

### 2. Add per-image size validation on the client (`src/components/steps/FileUploadStep.tsx`)
- After rendering images, check each image's base64 length
- If any image exceeds 4MB, re-render that specific page at lower quality (0.3) or scale (0.5)
- Log image sizes: `"Rendered 9 pages, avg 450KB/page, total 4.1MB"`

### 3. Graceful vision failure handling (`src/components/steps/FileUploadStep.tsx`)
- In `extractWithVisionPipeline` catch block:
  - Replace generic toast with a rich inline error card showing: "This document couldn't be processed automatically. Try pasting the plan text directly, or re-save the PDF at a lower resolution."
  - Add a "Paste Text Instead" button that switches to a textarea input mode
  - Log the error to `api_call_logs` with `status: 'error'` and full error details so failures appear in admin panel
- New state: `visionError` to control showing the error card + paste fallback UI

### 4. Log vision errors to api_call_logs (`src/components/steps/FileUploadStep.tsx`)
- When vision fails, insert an `api_call_logs` row from the frontend:
  ```typescript
  await supabase.from('api_call_logs').insert({
    session_id: sessionId,
    edge_function: 'process-plan',
    step_label: 'Vision extraction failed',
    status: 'error',
    error_message: error.message,
  });
  ```
- Also update session status to `'failed'`

### Files to modify

| File | Change |
|------|--------|
| `src/utils/pdfToImages.ts` | Reduce scale to 0.75, quality to 0.5, add maxDimension cap of 1600px |
| `src/components/steps/FileUploadStep.tsx` | Add image size validation after render, graceful error UI with "Paste Text Instead", log errors to api_call_logs |

