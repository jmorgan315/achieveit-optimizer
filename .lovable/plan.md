

# Pipeline Ownership: Guarding the catch blocks

## The Risk You Identified

Three outer `catch` blocks write `status: "error"` to the session on any exception:

- `runPipeline` catch (line 1216-1222)
- `runResume` catch (line 1483-1489)
- `runPostExtractionResume` errors bubble into `runResume`'s catch

If a superseded run encounters an unrelated exception *after* yielding ownership, that catch block would overwrite the new run's `status` and `current_step` with `"error"`.

## Confirmed: Early return is safe — but catch blocks are not

The plan's ownership checks use `if (!checkOwnership(...)) return;` — a clean return won't trigger catch blocks. That path is safe.

**The danger**: If a superseded run somehow throws between checks (e.g., a network error on a stale in-flight request), the catch fires and clobbers the session.

## The Fix

Add an ownership check inside each outer catch block before writing error status. The implementation should:

1. **Store `pipelineRunId` in a variable accessible to the catch block** (it's already scoped in the function body).

2. **In each catch block**, before writing `status: "error"`, re-check ownership:
   ```typescript
   } catch (error) {
     console.error("[process-plan] Pipeline error:", error);
     // Don't clobber session if we've been superseded
     if (await checkOwnership(sessionId, pipelineRunId)) {
       await updateSessionProgress(sessionId, {
         status: "error",
         current_step: "error",
         step_results: { error: "Pipeline processing failed." },
       });
     } else {
       console.warn(`[process-plan] Suppressing error write — run ${pipelineRunId} was superseded`);
     }
   }
   ```

3. Apply this pattern to both catch blocks:
   - `runPipeline` (line 1216)
   - `runResume` (line 1483) — pass `pipelineRunId` through so it's available

4. `runPostExtractionResume` needs `pipelineRunId` as a parameter (already in the plan) so `runResume`'s catch can use it.

## Summary

The plan's early-return approach is correct. This is one additional safeguard: **guard the catch blocks with an ownership check** so a dying superseded run can't write `status: "error"` over the new run's progress.

## Files

| File | Change |
|------|--------|
| `supabase/functions/process-plan/index.ts` | Add ownership check in catch blocks of `runPipeline` and `runResume` before writing error status |

