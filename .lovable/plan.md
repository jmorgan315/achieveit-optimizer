

## Fix: Surface Dedup Results to the Client

### Root Cause

The `DedupSummaryCard` component and all wiring (props, state, restore handler) are intact. The data is simply never delivered to the client.

**Server side** (`process-plan/index.ts`): The dedup `removedDetails` array is logged to `api_call_logs` (as `removed_items` in `response_payload`) but is **not included** in the final `step_results` written when the pipeline completes. The completion write at line 2099-2113 contains `data`, `totalItems`, `corrections`, `sessionConfidence`, `auditSummary`, `extractionMethod`, `pipelineComplete` — but no `dedupResults`.

**Client side** (`FileUploadStep.tsx`): The polling function returns `step_results` directly (line 455: `return results`), and the consumer reads `result.dedupResults` (line 176). Since the server never wrote it, it's always `undefined` → `[]`.

**Resume/hydration path** (`Index.tsx` line 238-270): The hydration logic extracts `data.items` and `data.detectedLevels` from `step_results` but never reads `dedupResults` either.

### Fix

#### 1. `supabase/functions/process-plan/index.ts` — Include dedupResults in final step_results

The `dedupResult.removedDetails` variable is available in scope during the pipeline. Thread it through to the final completion write.

**At line ~1260** (extractionSnapshot construction), add `dedupResults` to the snapshot:
```typescript
const extractionSnapshot = {
  extraction: { ... },
  classification: ...,
  pipelineContext: { ... },
  audit: null,
  validation: null,
  dedupResults: dedupResult.removedDetails,  // ADD THIS
};
```

**At line ~2102** (final completion write), include it:
```typescript
step_results: {
  success: true,
  data: { items: finalItems, detectedLevels: finalLevels },
  totalItems: finalItemCount,
  corrections,
  sessionConfidence,
  auditSummary: auditFindings?.auditSummary || null,
  extractionMethod,
  pipelineComplete: true,
  sessionId,
  dedupResults: existingStepResults?.dedupResults || [],  // ADD THIS
},
```

The same needs to be done in the resume paths (~lines 1468, 1576, 1704) where `extractionSnapshot` is rebuilt — include `dedupResults: dedupResult.removedDetails`.

#### 2. `src/pages/Index.tsx` — Hydrate dedupResults on session resume

At line ~257, after converting items, add:
```typescript
const dedupData = (stepResults?.dedupResults || []) as DedupRemovedDetail[];
setDedupResults(dedupData);
```

#### 3. Deploy the updated edge function

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/process-plan/index.ts` | Add `dedupResults` to extractionSnapshot and final completion `step_results` (4-5 locations) |
| `src/pages/Index.tsx` | Hydrate `dedupResults` from `step_results` on session resume (~1 line) |

### What stays the same
- `FileUploadStep.tsx` polling already reads `result.dedupResults` — no change needed there
- `DedupSummaryCard` component — no change needed
- `PlanOptimizerStep` prop wiring — no change needed

