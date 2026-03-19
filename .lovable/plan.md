

# Wire classify-document into process-plan Pipeline

## Overview
Add classify-document as Step 0 in the extraction pipeline, update the frontend to show 5 steps (upload + 4 agent steps), and show classification results in the admin session detail page. Also add two new columns to `processing_sessions` for classification metadata.

## 1. Database Migration
Add two columns to `processing_sessions`:
- `document_type text` (nullable)
- `classification_result jsonb` (nullable)

## 2. Edge Function: `supabase/functions/process-plan/index.ts`

**Before Agent 1 extraction block, insert Agent 0 — Document Classification:**
- Call `classify-document` via `callEdgeFunction` with `{ pageImages, orgName: organizationName, industry, userPlanLevels: planLevels, pageRange, sessionId }`
- Only run when `useVision` is true (vision path has page images; text path doesn't benefit from classification)
- Store result as `classification`
- Derive `extractionMode`: `"table"` if `document_type === "tabular" && table_structure`, `"presentation"` if `document_type === "presentation" || "mixed"`, else `"standard"`
- Log `extractionMode` to console
- Update session row: `document_type` and `classification_result`

**Filter page images for Agent 1:**
- If `classification.plan_content_pages` exists and is non-empty, filter `pageImages` to only those 1-indexed pages before passing to extraction batching
- For text path, if `classification.extraction_recommendations.page_range` exists, slice text (not implemented yet since text path skips classification)

**Pass classification to Agent 2:**
- Add `classification` field to the audit-completeness payload

**Renumber console logs:**
- Agent 0 = "Step 0", Agent 1 = "Step 1", Agent 2 = "Step 2", Agent 3 = "Step 3"

## 3. Frontend: `src/components/steps/ProcessingOverlay.tsx`

Update to 5 steps:
```
ProcessingStep = 'upload' | 'classify' | 'extract' | 'audit' | 'validate'

STEP_CONFIG: Upload, Classify, Extract, Audit, Validate
  - Classify icon: Eye (or Scan)

STEP_RANGES:
  upload:   { start: 0,  size: 10 }
  classify: { start: 10, size: 10 }
  extract:  { start: 20, size: 40 }
  audit:    { start: 60, size: 20 }
  validate: { start: 80, size: 20 }
```

Add contextual message for classify step.

## 4. Frontend: `src/components/steps/FileUploadStep.tsx`

In `extractWithVisionPipeline`, update progress calls:
- After rendering images: `setStepProgress('classify', 0)` then `addMessage('Classifying document structure...')`
- After process-plan returns: step through classify→extract→audit→validate progress updates

## 5. Admin: `src/pages/admin/SessionDetailPage.tsx`

**Add classification card** between session summary and API Call Timeline:
- Only show if `session.classification_result` exists
- Collapsible card titled "Document Classification"
- Show `document_type` as a badge, `confidence` as percentage
- Show `plan_content_pages` as comma-separated list
- Show `hierarchy_pattern.detected_levels` as badges
- Expandable "Full Classification JSON" section with pre-formatted JSON

**Update Session interface** to include `document_type` and `classification_result` fields.

## Files to modify

| File | Change |
|------|--------|
| Migration | Add `document_type` and `classification_result` columns to `processing_sessions` |
| `supabase/functions/process-plan/index.ts` | Add Agent 0 call, page filtering, pass classification to audit, update session |
| `src/components/steps/ProcessingOverlay.tsx` | Add 'classify' step, update ranges |
| `src/components/steps/FileUploadStep.tsx` | Add classify progress step |
| `src/pages/admin/SessionDetailPage.tsx` | Add classification card, update Session type |

