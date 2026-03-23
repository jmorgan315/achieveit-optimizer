

# Resumable Pipeline with Partial Persistence

## Problem
The `process-plan` edge function exceeds Deno's execution time limit (~150-300s) when processing 40+ page documents. Extraction (Agent 1) succeeds but the isolate dies before Agents 2+3 complete, losing all work.

## Solution
Persist extraction results after Agent 1, then allow the frontend to trigger a lightweight resume call for Agents 2+3 only. The user never sees an error.

## Changes

### File 1: `supabase/functions/process-plan/index.ts`

**Add extraction persistence** (after line 573, before line 578 "STEPS 2 & 3"):
- Write Agent 1 results to `step_results` with structure `{ extraction: { items, detectedLevels, completed_at }, classification, audit: null, validation: null }`
- Set `current_step` to `"extraction_complete"`
- Continue running Agents 2+3 as normal

**Add resume mode** (in the `serve()` handler, lines 751-795):
- Check for `resume_session_id` in request body
- If present: read session row, verify `current_step === "extraction_complete"`, load persisted extraction data + classification, skip directly to Agents 2+3 (audit + validate in parallel), then write final merged results
- If `current_step` is already `"completed"`, return immediately
- Log the resume call to `api_call_logs`

**Update final result write** (lines 718-739):
- Include `extraction`, `audit`, and `validation` sub-keys in `step_results` for structured persistence

### File 2: `src/components/steps/FileUploadStep.tsx`

**Increase polling timeout**: `MAX_POLLS` from 120 → 200 (10 minutes)

**Add stall detection in polling loop** (inside the `for` loop, after step change detection):
- Track when `current_step` first becomes `"extraction_complete"` (save timestamp)
- If stuck at `"extraction_complete"` for >20 seconds, fire a resume call: `POST /process-plan` with `{ resume_session_id: sessionId }`
- Only attempt resume once per session (use a flag variable)
- Continue polling after triggering resume

**Add timeout fallback** (replace the throw on line 241):
- On MAX_POLLS reached, fetch session one more time
- If `step_results` contains extraction data, use it as partial result with warning toast
- If no data, show existing error

## Technical Details

- Resume goes to the same `process-plan` function — no new edge function needed
- No changes to Agent 0, 1, 2, or 3 logic/prompts
- `step_results` column already exists as JSONB on `processing_sessions`
- The extraction persistence write happens AFTER the flattener/safety-net runs (line 573), so persisted data is the clean flat array

## Expected Behavior

| Scenario | Result |
|----------|--------|
| Short doc (<20 pages) | No visible change, pipeline completes normally |
| Large doc, happy path | Extraction persisted → Agents 2+3 finish in time → full result |
| Large doc, timeout during 2+3 | Extraction persisted → frontend detects stall → fires resume → resume completes 2+3 → full result, no error |
| Worst case (resume also fails) | Frontend uses partial extraction results with warning toast |

