

# Per-Batch Persistence for Pipeline Resilience

## Overview

Save extraction progress after each batch and persist rendered page images to storage so the resume path can pick up mid-extraction without the frontend resending images.

## Changes

### 1. Create storage bucket for page images

**Migration**: Create a `page-images` storage bucket with public read access. Images are stored as `{sessionId}/{pageIndex}.jpg`.

### 2. Persist page images before extraction begins

**File: `supabase/functions/process-plan/index.ts`** (after classification, before extraction loop ~line 535)

After Agent 0 completes and page filtering is done, upload all filtered page images to storage:
- For each image data URL, convert to a Blob and upload to `page-images/{sessionId}/{pageIndex}.jpg`
- Store a mapping of `pageIndex → original page number` in the session's `step_results.extraction.page_map`
- Use the service role client for uploads
- Log: "Persisted N page images to storage for session {sessionId}"

This runs once before extraction begins. The overhead is acceptable since images are already in memory as base64 data URLs.

### 3. Save state after each extraction batch

**File: `supabase/functions/process-plan/index.ts`** (inside batch loop, after ~line 625)

After each batch's results are merged into `allItems`, persist incremental state:

```typescript
await updateSessionProgress(sessionId, {
  current_step: "extracting",
  step_results: {
    extraction: {
      items: allItems,
      detectedLevels,
      batches_completed: batchIdx + 1,
      batches_total: batches.length,
      batch_pages: batches.map((b, i) => /* page indices for each batch */),
      completed_at: batchIdx === batches.length - 1 ? new Date().toISOString() : null,
    },
    classification: classification || null,
    pipelineContext: {
      organizationName, industry, planLevels,
      documentText: (documentText as string) || "",
      extractionMethod, useVision,
      previousContext,  // for batch continuity
    },
  },
});
```

After the last batch, continue to set `current_step: "extraction_complete"` as before (existing checkpoint at line 783).

### 4. Expand resume logic to handle mid-extraction resume

**File: `supabase/functions/process-plan/index.ts`** (`runResume` function, lines 968-1160)

Change signature to `async function runResume(sessionId: string): Promise<void>` (no image parameter needed — images come from storage).

Add resume paths:

**Path A — `current_step === "extracting"`:**
- Read `step_results.extraction.batches_completed`, `batches_total`, `batch_pages`
- Download page images from storage: `page-images/{sessionId}/*.jpg`
- Convert back to data URL strings
- Determine which batches remain (batches where index >= `batches_completed`)
- Rebuild page image arrays for remaining batches using `batch_pages`
- Resume extraction loop from the next unprocessed batch, using persisted `previousContext`
- After all batches complete, run dedup → Agents 2+3

**Path B — `current_step === "extracting"` with `batches_completed === batches_total`:**
- All batches done but dedup/agents never ran
- Run dedup → Agents 2+3 (same as existing extraction_complete path)

**Path C — `current_step === "extraction_complete"` (existing):**
- No change — runs Agents 2+3

Update the guard at line 988 to accept `"extracting"` in addition to `"extraction_complete"`.

### 5. Frontend stall detection for extracting phase

**File: `src/components/steps/FileUploadStep.tsx`** (polling loop, lines 195-256)

Add tracking for extraction-phase stalls:

```typescript
let lastBatchCount: number | null = null;
let batchStallStart: number | null = null;
let hasAttemptedExtractionResume = false;
// rename existing: hasAttemptedResume → hasAttemptedAuditResume
```

In the polling loop, when `step === "extracting"`:
- Read `session.step_results?.extraction?.batches_completed`
- If changed from last poll, reset `batchStallStart`
- If unchanged for >30s AND `!hasAttemptedExtractionResume`:
  - Set flag, fire lightweight resume: `{ resume_session_id: pollSessionId }` (no images needed)
  - Add message: "Resuming extraction..."

Keep existing `extraction_complete` stall detection (20s) with renamed flag `hasAttemptedAuditResume`.

Update timeout fallback (line 279) to check `batches_completed < batches_total` for a more specific warning: "Extraction partially complete — some items may be missing."

### 6. Cleanup: delete stored images after pipeline completes

**File: `supabase/functions/process-plan/index.ts`** (after final result write, ~line 953)

After writing final results with `status: "completed"`, delete the session's images from storage:
```typescript
await client.storage.from('page-images').remove([...all files for sessionId]);
```

Fire-and-forget — don't let cleanup failure block completion.

## Files Summary

| File | Change |
|------|--------|
| Migration (SQL) | Create `page-images` storage bucket |
| `supabase/functions/process-plan/index.ts` | Upload images to storage before extraction; save state after each batch; expand resume for mid-extraction; cleanup images on completion |
| `src/components/steps/FileUploadStep.tsx` | Add extracting-phase stall detection (30s); rename existing resume flag |

## What NOT to change
- No agent function or prompt changes
- No batch size or page filtering changes
- No dedup logic changes
- No admin logging changes (existing per-batch logging is fine)

