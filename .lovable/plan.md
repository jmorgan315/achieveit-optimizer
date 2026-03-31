

# Fix: Prevent Concurrent Pipeline Execution via `pipeline_run_id`

## Problem
The original pipeline and resume run concurrently as independent background tasks. Even with the `updateSessionProgress` guard, both processes execute duplicate batches and the last writer wins, corrupting state.

## Approach: `pipeline_run_id` Ownership Token

Each pipeline execution (original or resume) generates a unique run ID and writes it to the session at start. Every subsequent `updateSessionProgress` call checks that the stored `pipeline_run_id` still matches before writing. If a resume starts, it sets a new run ID — making all of the original pipeline's subsequent writes silently no-op.

## Changes

### 1. Database Migration
Add `pipeline_run_id` column to `processing_sessions`:
```sql
ALTER TABLE processing_sessions ADD COLUMN pipeline_run_id text;
```

### 2. `supabase/functions/process-plan/index.ts`

**a) Modify `updateSessionProgress` to accept and enforce a `runId`**

Add optional `runId` parameter. When provided, the function reads the current `pipeline_run_id` from the session and skips the update if it doesn't match (meaning another process has taken ownership).

```
updateSessionProgress(sessionId, updates, runId?)
  → if runId provided:
      read current pipeline_run_id from DB
      if current !== runId → log "stale run, skipping" → return
  → proceed with update as before
```

**b) `runPipeline`: claim ownership at start**

At the top of `runPipeline`, generate a run ID (`crypto.randomUUID()`), write it to the session alongside the initial `in_progress` status, and pass it to every `updateSessionProgress` call throughout the function. This includes:
- Per-batch persistence writes (line ~934)
- The extraction_complete checkpoint
- The final completion write
- Error status writes

**c) `runResume`: claim ownership at start, check for stale original**

At the top of `runResume`, after reading the session, generate a new run ID and write it to the session. This immediately invalidates the original pipeline's run ID. Pass the new run ID to all `updateSessionProgress` calls within resume.

**d) Serve handler: pass run ID for initial status update**

In the `serve` handler (line ~1843), the initial `updateSessionProgress` for `in_progress` should also use the run ID that will be passed to `runPipeline`. Generate the run ID in the handler and pass it as a parameter to `runPipeline`.

### 3. Propagate `runId` through helper functions

Both `runPostExtractionResume` and any other internal functions that call `updateSessionProgress` need to accept and forward the `runId` parameter.

## How It Prevents the Race

```text
T=0   Original starts, sets pipeline_run_id = "aaa"
T=30  Original writes batch 1 (runId="aaa" matches → OK)
T=45  Resume starts, sets pipeline_run_id = "bbb"
T=50  Original tries to write batch 2 (runId="aaa" ≠ "bbb" → SKIPPED)
T=55  Resume writes batch 2 (runId="bbb" matches → OK)
...   Original's remaining writes all silently no-op
```

## Files to Modify

| File | Change |
|------|--------|
| DB migration | Add `pipeline_run_id text` column to `processing_sessions` |
| `supabase/functions/process-plan/index.ts` | Add run ID generation, ownership check in `updateSessionProgress`, propagate through `runPipeline`, `runResume`, `runPostExtractionResume`, and serve handler |

