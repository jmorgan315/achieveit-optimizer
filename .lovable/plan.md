
# Vision Fallback to Text + Improved Agent 0 Classification — IMPLEMENTED

## What was done

### 1. Frontend: documentText sent alongside pageImages
- `FileUploadStep.tsx`: `extractWithVisionPipeline` now accepts optional `documentText` parameter
- When vision path is chosen, `textResult?.text` is included in the `process-plan` request body
- Both the "text found 0 items → vision" and "poor text quality → vision" paths pass text

### 2. Backend: Vision fallback to text extraction
- `process-plan/index.ts`: When vision produces 0 items AND `documentText` exists (>50 chars):
  - Logs warning: "Step 1: Vision extraction failed — falling back to text extraction results"
  - Calls `extract-plan-items` with the document text
  - Sets `extractionMethod = "text_fallback"` for admin visibility
  - Only marks session as failed if BOTH vision AND text produce 0 items
- `useVision` logic updated: vision is used when `pageImages` exist regardless of `documentText` presence

### 3. Agent 0 classification prompt improved
- `classify-document/index.ts`: Added "CRITICAL CLASSIFICATION DECISION" section after document_type definitions
  - Clear rule: "tabular" = tables ARE the plan structure; "text_heavy" = narrative with supporting tables
  - Decision rule for mixed documents
  - Three concrete examples (tabular, text_heavy, presentation)

## Files changed
| File | Change |
|------|--------|
| `src/components/steps/FileUploadStep.tsx` | Thread `textResult.text` into vision pipeline call |
| `supabase/functions/process-plan/index.ts` | Text fallback when vision produces 0 items; fixed `useVision` logic |
| `supabase/functions/classify-document/index.ts` | Classification decision rule and examples in system prompt |
