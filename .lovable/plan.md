

# Diagnosis: Resume Polling Path Analysis

## What the code shows

1. **`handleSelectSession` (Index.tsx:270-275)**: Correctly sets `resumePollingOnly = true` for in_progress sessions.

2. **`FileUploadStep` autoStart effect (line 109-114)**: Correctly checks `autoStart && !resumePollingOnly` — should NOT fire when resuming.

3. **`FileUploadStep` resume effect (line 118-174)**: Correctly fires only when `resumePollingOnly && sessionId` is true, calls `pollForResults` only.

4. **Stall detector (lines 376-384)**: Sends `{ resume_session_id: pollSessionId }` to process-plan, which triggers the `runResume` path — NOT a fresh pipeline. This is correct.

## Likely root cause

The 4 pipeline starts visible in the admin timeline are probably from the **original upload**, not from clicking the in_progress session. The `hasAutoStarted` ref resets when the component unmounts/remounts. If the user navigated away from the processing screen and back (e.g. clicked Back then Forward, or the component remounted for other reasons), `handleFileUpload` would fire again, calling `process-plan` with the full payload each time.

Another possibility: React's StrictMode double-mounting in development could cause the autoStart effect to fire twice.

## Plan

### 1. Add diagnostic console.logs to trace execution paths

In `FileUploadStep.tsx`:
- Top of autoStart `useEffect`: log `autoStart`, `resumePollingOnly`, `uploadedFile`, `hasAutoStarted.current`, `isProcessing`
- Top of resumePollingOnly `useEffect`: log `resumePollingOnly`, `sessionId`, `hasResumeStarted.current`
- Top of `handleFileUpload`: log that it was called and from which path

### 2. Guard `handleFileUpload` against duplicate invocations

Add a ref `isUploadInFlight` that prevents `handleFileUpload` from being called while a previous call is still running. This prevents duplicate pipeline starts from re-mounts, double-clicks, or React StrictMode.

### 3. Guard `extractWithVisionPipeline` and `extractPlanItemsWithAI` similarly

Both call `process-plan` — add the same in-flight guard so they can't fire concurrently.

## Files to modify

| File | Change |
|------|--------|
| `src/components/steps/FileUploadStep.tsx` | Add console.logs to autoStart effect, resume effect, and handleFileUpload. Add `isUploadInFlight` ref guard to prevent duplicate process-plan calls. |

