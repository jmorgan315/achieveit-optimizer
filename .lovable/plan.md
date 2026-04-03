

# Backend Self-Chaining — Remove Browser Dependency

## Summary
Make `process-plan` self-chaining so it saves progress and dispatches a new invocation of itself before the 150s Supabase timeout kills it. The browser becomes a passive poller instead of the primary resume mechanism.

## Changes

### 1. `supabase/functions/process-plan/index.ts`

**Add time-tracking and dispatch helper** (top of file, after existing helpers):
- `const START_TIME = Date.now()` captured at function entry (inside `runPipeline` and `runResume`)
- `shouldChain(startTime)`: returns true when `Date.now() - startTime > 120_000`
- `dispatchChain(sessionId, pipelineRunId)`: fire-and-forget fetch to self using `SUPABASE_SERVICE_ROLE_KEY` for auth, passing `{ resume_session_id, isChainedResume: true }`

**Integrate `shouldChain()` checks into `runPipeline`:**
- Before each vision extraction batch (line ~846 loop): check `shouldChain()`, if true → persist current state (already happens), call `dispatchChain()`, return
- Before each text extraction chunk (line ~1001 loop): same pattern
- After extraction completes, before Agent 2 (line ~1220): check → chain if needed
- Current code already returns after Agent 2 ("Agent 3 will run in next resume cycle") — this is fine, but instead of relying on the browser stall detector, add a `dispatchChain()` call after persisting "audited" state (line ~1279)

**Integrate `shouldChain()` checks into `runResume`:**
- Pass `startTime` through, check before each resumed vision/text batch
- Before running Agent 2 (line ~1649): check → chain
- After Agent 2 completes (runAgent2Only, line ~1741): instead of comment "Agent 3 will run in next resume cycle", call `dispatchChain()` directly
- Before each Agent 3 batch (line ~1841 loop): check → chain
- In `runAgent3Only`: after each batch persists, check `shouldChain()` → chain if needed

**Handle `isChainedResume` in serve handler:**
- The `isChainedResume` flag routes into the same `runResume()` path — no logic change needed, just log it for admin visibility

**Key design notes:**
- Same `pipelineRunId` is NOT passed through the chain (each resume generates a new one via `runResume`). This is the existing pattern and works because `runResume` writes its own `pipeline_run_id` at start
- The chained call uses `resume_session_id` — identical to what the browser sends, so it follows the exact same code path

### 2. `src/components/steps/FileUploadStep.tsx`

**Relax stall detector thresholds** (safety net only):
- Extraction stall: `120000` → `300000` (120s → 300s)  
- Post-extraction agent running: `120000` → `300000`
- Post-extraction idle states: `20000` → `300000` (all states get same 300s threshold since chaining handles transitions)
- Keep `MAX_RESUMES = 20` and `MAX_POLLS = 800` unchanged

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/process-plan/index.ts` | Add `shouldChain()`, `dispatchChain()`, integrate time checks before each batch/agent, self-chain after Agent 2 |
| `src/components/steps/FileUploadStep.tsx` | Relax stall thresholds to 300s |

## No Changes To
- Session state schema, per-batch persistence, resume logic, Agent 0, other edge functions, frontend polling loop, page/validation limits

