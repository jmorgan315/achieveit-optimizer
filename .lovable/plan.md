

# Fix: Pass Quick Scan Classification to process-plan (Skip Redundant Agent 0)

## Problem
Classification runs twice:
1. Quick scan on Screen 1 calls `classify-document` and stores the result in `classificationResult` state
2. `process-plan` calls `classify-document` again at line 681 when the pipeline starts

## Root Cause
- `FileUploadStep` sends `pageImages`, `documentText`, `organizationName`, etc. to `process-plan` (line 465-478) but never sends the existing classification result
- `runPipeline` (line 651) destructures the body but has no `classificationResult` field — it always runs Agent 0 fresh

## Fix (2 files)

### 1. `supabase/functions/process-plan/index.ts`

**Accept optional `classificationResult` in the request body** (line 657-665):
```typescript
const {
  documentText, organizationName, industry, documentHints,
  pageImages, planLevels, pageRange,
  classificationResult: preClassification,  // NEW
} = body;
```

**Skip Agent 0 if pre-classification is provided** (replace lines 670-715):
```typescript
let classification: Record<string, unknown> | null = null;
let extractionMode: "standard" | "table" | "presentation" = "standard";

if (preClassification && typeof preClassification === "object") {
  // Use classification from quick scan — skip Agent 0
  classification = preClassification as Record<string, unknown>;
  console.log("[process-plan] Using pre-computed classification, skipping Agent 0. document_type:", classification.document_type);

  const docType = classification.document_type as string;
  const tableStructure = classification.table_structure;
  if (docType === "tabular" && tableStructure) {
    extractionMode = "table";
  } else if (docType === "presentation" || docType === "mixed") {
    extractionMode = "presentation";
  }
  console.log("[process-plan] Extraction mode:", extractionMode);

  // Save to session (same as normal path)
  await updateSessionProgress(sessionId, {
    document_type: classification.document_type || null,
    classification_result: classification,
  });
} else if (useVision) {
  // Existing Agent 0 logic unchanged
  console.log("[process-plan] Starting Step 0 (document classification)");
  // ... rest of existing classification block stays the same
}
```

### 2. `src/components/steps/FileUploadStep.tsx`

**Pass the classification result in the process-plan request body** (around line 468):

Add `classificationResult` from the `orgProfile` (or a new prop). The simplest approach: pass it through `orgProfile` since `ScanResultsStep` already builds `ProcessingConfig` which flows into `orgProfile`.

Two sub-changes:
- Add `classificationResult` to `OrgProfile` type in `src/types/plan.ts`
- In `Index.tsx` `handleStartProcessing`, store the classification result on the org profile
- In `FileUploadStep.tsx` line 468, add `classificationResult: orgProfile?.classificationResult` to the request body

**Alternative (simpler):** Pass `classificationResult` as a separate prop to `FileUploadStep` and include it in the fetch body. This avoids polluting `OrgProfile`.

### Recommended: Separate prop approach

**`src/components/steps/FileUploadStep.tsx`** — add prop:
```typescript
classificationResult?: Record<string, unknown> | null;
```

Include in the fetch body at line 468:
```typescript
body: JSON.stringify({
  pageImages: images.map(img => img.dataUrl),
  documentText: documentText || "",
  organizationName: orgProfile?.organizationName,
  industry: orgProfile?.industry,
  documentHints: orgProfile?.documentHints,
  planLevels: orgProfile?.planLevels,
  pageRange: orgProfile?.pageRange,
  classificationResult,  // pass pre-computed classification
  sessionId,
}),
```

**`src/pages/Index.tsx`** — pass the prop at step 2:
```tsx
<FileUploadStep
  classificationResult={classificationResult}
  // ... existing props
/>
```

The `classificationResult` state already exists in `Index.tsx` (set during quick scan).

## Files to modify

| File | Change |
|------|--------|
| `supabase/functions/process-plan/index.ts` | Accept `classificationResult` in body, skip Agent 0 when present |
| `src/components/steps/FileUploadStep.tsx` | Add `classificationResult` prop, include in fetch body |
| `src/pages/Index.tsx` | Pass `classificationResult` state to `FileUploadStep` |

## What stays unchanged
- `classify-document` edge function (no changes)
- `UploadIdentifyStep` (already stores classification correctly)
- `ScanResultsStep` (reads classification, doesn't need to change)
- All other agents (1, 2, 3) unaffected

