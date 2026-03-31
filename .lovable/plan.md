

# Fix: Pipeline Race Condition — Concurrent Original + Resume Overwrites Completion

## Root Cause (confirmed from DB)

The session `6abad137` has this contradictory state:
- `status: "completed"` 
- `current_step: "extracting"` 
- `batches_completed: 4` of 5
- `pipeline_complete: null`
- `step_results` contains raw extraction items, NOT final pipeline output

**What happened**: The original pipeline and the resume ran **concurrently**. API logs prove it:

| Time | Source | Action |
|------|--------|--------|
| 19:12:44 | Original | Batch 1 of 5 |
| 19:13:22 | Resume | "Resume: continuing from batch 2" |
| 19:13:37 | Original | Batch 2 of 5 (still alive!) |
| 19:14:49 | Resume | Batch 2 of 5 [Resume] |
| 19:15:32 | Resume | Batch 3 of 5 [Resume] |

The original pipeline eventually completed all 5 batches + dedup + agents 2+3 and wrote `status: "completed"` + `current_step: "complete"` + final `step_results`. Then the resume's per-batch persistence **overwrote** `current_step` back to `"extracting"` and `step_results` with partial extraction data (4 batches). The `status: "completed"` survived because `updateSessionProgress` does partial updates.

The client polled, saw `status === "completed"`, and returned the corrupted `step_results` — which had raw extraction items with no dedup, audit, or validation applied.

## Fix Strategy

Two changes to prevent concurrent pipeline corruption:

### Fix 1: Guard `updateSessionProgress` against overwriting completed sessions

**File**: `supabase/functions/process-plan/index.ts`, `updateSessionProgress` function (lines 18-26)

Before performing the update, read the current `status`. If it's already `"completed"` or `"complete"`, skip the update (unless the new update is ALSO setting completion). This prevents resume's per-batch writes from corrupting a finished session.

```ts
async function updateSessionProgress(sessionId: string, updates: Record<string, unknown>): Promise<void> {
  try {
    const client = getServiceClient();
    
    // Don't overwrite a completed session unless we're also completing
    if (!updates.status || (updates.status !== 'completed' && updates.status !== 'complete')) {
      const { data: current } = await client
        .from("processing_sessions")
        .select("status")
        .eq("id", sessionId)
        .single();
      
      if (current?.status === 'completed') {
        console.log(`[process-plan] Skipping update — session ${sessionId} already completed`);
        return;
      }
    }
    
    const { error } = await client.from("processing_sessions").update(updates).eq("id", sessionId);
    if (error) console.error("[process-plan] Failed to update session progress:", error.message);
  } catch (e) {
    console.error("[process-plan] updateSessionProgress exception:", e);
  }
}
```

### Fix 2: Resume should abort if session is already completed

**File**: `supabase/functions/process-plan/index.ts`, `runResume` function

The check at line 1350 already handles `completed`/`complete` for `current_step`. But due to the race, `current_step` might say `"extracting"` while `status` says `"completed"`. Add a status check:

```ts
// Line ~1349, after reading session
const currentStep = (session as Record<string, unknown>).current_step as string;
const currentStatus = (session as Record<string, unknown>).status as string;

if (currentStep === "completed" || currentStep === "complete" || currentStatus === "completed") {
  console.log("[process-plan] Resume: already completed, nothing to do");
  return;
}
```

Also add the same check to `runResume`'s select query — fetch `status` too (line 1340 currently only selects `step_results, current_step, org_name, org_industry`).

### Fix 3: Handle `validating` state in resume

**File**: `supabase/functions/process-plan/index.ts`, `runResume` function (line 1563)

Currently, if `current_step === "validating"`, the resume logs an error and returns — leaving the session stuck forever. Add handling for this state by re-running agents 2+3 using the extraction data from `step_results`:

```ts
if (currentStep === "validating") {
  // Agents were running but timed out — re-run from extraction data
  const extraction = stepResults?.extraction as Record<string, unknown> | undefined;
  if (extraction?.items && Array.isArray(extraction.items) && extraction.items.length > 0) {
    console.log("[process-plan] Resume: stuck at validating, re-running agents 2+3");
    const pipeCtx = (stepResults.pipelineContext || {}) as Record<string, unknown>;
    await runPostExtractionResume(sessionId, extraction.items, ...);
    return;
  }
}
```

Insert this before the `currentStep !== "extraction_complete"` check at line 1563.

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/process-plan/index.ts` | (1) Guard `updateSessionProgress` against overwriting completed sessions; (2) Check `status` in resume abort logic; (3) Handle `validating` state in resume |

No database migrations. No frontend changes. Deploy edge function after changes.

