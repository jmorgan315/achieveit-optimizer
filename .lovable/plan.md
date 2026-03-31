

# Pipeline Resilience Fixes

## Summary

Three changes to stabilize the pipeline for large documents:
1. Add retry with backoff to audit-completeness and validate-hierarchy (the only two functions missing it)
2. Add graceful chunk-skip logic in process-plan's classification loop
3. Ensure classification completes fully before extraction starts (already sequential, but add explicit gate)

## Current State

- **classify-document**: Already has `callAnthropicWithRetry` (4 retries, exponential backoff, retries on 429/500/502/503/529)
- **extract-plan-vision**: Same retry logic
- **extract-plan-items**: Same retry logic
- **audit-completeness**: NO retry — single `fetch` call at line 362
- **validate-hierarchy**: NO retry — single `fetch` call at line 315
- **Retryable statuses**: 429, 500, 502, 503, 529 — missing 408 (timeout) per user request

## Changes

### 1. Shared retry utility in `_shared/logging.ts`

Add a shared `callAnthropicWithRetry` function to `supabase/functions/_shared/logging.ts`:
- 3 retries (4 total attempts)
- Backoff: 5s, 15s, 30s (fixed schedule per user spec)
- Retryable statuses: 408, 429, 500, 502, 503, 529
- Respects `retry-after` header when present
- Logs each retry attempt

Then update **audit-completeness** and **validate-hierarchy** to import and use this shared function instead of raw `fetch`. The existing retry logic in classify-document, extract-plan-vision, and extract-plan-items already works — update their retryable status sets to include 408, but keep their existing implementations to minimize blast radius.

### 2. Graceful chunk-skip in process-plan classification loop

In `supabase/functions/process-plan/index.ts`, lines 681-727 (the chunked classification loop):

When a chunk fails after the edge function call (line 724-726), instead of just logging a warning:
- Log the failure with chunk index and page range to api_call_logs
- Mark those pages as "unclassified" by generating synthetic page_annotations with `contains_plan_items: true` and `classification: "unclassified"`
- Add those page numbers to `plan_content_pages` in the merged result
- This ensures unclassified pages are sent to extraction as a safety measure

Also add a retry wrapper around the `callEdgeFunction("classify-document", ...)` call itself (up to 2 retries with 5s/15s delays) since the edge function might fail at the HTTP transport level even though the inner Anthropic call has its own retries.

### 3. Explicit classification gate before extraction

The code at line 797 (`await updateSessionProgress(sessionId, { current_step: "extracting" })`) already runs sequentially after the classification loop exits. The classification loop is a synchronous `for` loop with `await` inside — it cannot advance to extraction before all chunks complete or fail.

However, add an explicit log line after the classification section confirming all chunks are done, and add a guard: if `classification` is still null after the loop (all chunks failed), build a fallback classification that marks all pages as plan_content so extraction proceeds safely.

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/_shared/logging.ts` | Add shared `callAnthropicWithRetry` function |
| `supabase/functions/audit-completeness/index.ts` | Replace raw `fetch` (line 362) with shared retry function |
| `supabase/functions/validate-hierarchy/index.ts` | Replace raw `fetch` (line 315) with shared retry function |
| `supabase/functions/classify-document/index.ts` | Add 408 to `RETRYABLE_ANTHROPIC_STATUSES` |
| `supabase/functions/extract-plan-vision/index.ts` | Add 408 to `RETRYABLE_ANTHROPIC_STATUSES` |
| `supabase/functions/extract-plan-items/index.ts` | Add 408 to `RETRYABLE_ANTHROPIC_STATUSES` (check if it has the set) |
| `supabase/functions/process-plan/index.ts` | Add chunk-skip with unclassified page fallback, retry wrapper for chunk calls, fallback classification if all chunks fail |

All 7 edge functions will be redeployed.

### What This Does NOT Change
- No prompt changes
- No UX/frontend changes
- No new features
- No database migrations

