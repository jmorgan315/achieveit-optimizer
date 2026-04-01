

# Enable Repeated Automatic Resumes from Frontend Stall Detector

## Overview
Remove the single-fire guards on both stall detectors and allow them to re-arm after each resume. Cap at 20 total resumes. Show friendly continuation messages in the Activity Log. Track a progress high-water mark so the bar never goes backwards.

## Changes — single file: `src/components/steps/FileUploadStep.tsx`

### 1. Replace single-fire booleans with a shared counter

Remove `hasAttemptedExtractionResume` and `hasAttemptedAuditResume`. Replace with:
```typescript
let resumeCount = 0;
const MAX_RESUMES = 20;
```

### 2. Modify extraction stall detection (lines 264-293)

Replace the `!hasAttemptedExtractionResume` guard with `resumeCount < MAX_RESUMES`. After firing a resume:
- Increment `resumeCount`
- Reset `batchStallStart = null` so the 30s timer re-arms
- Log: `console.log(`[Polling] Resume attempt ${resumeCount} of ${MAX_RESUMES}`)``
- Add friendly message: `addMessage(`Processing large document... (continuation ${resumeCount})`)` instead of "Resuming extraction..."

Before firing, check session status — if `session.status === 'completed' || session.status === 'error'`, skip the resume (the existing status checks at lines 319-328 handle completion, but the stall detection runs before those checks; add a quick guard).

### 3. Modify post-extraction stall detection (lines 295-317)

Same pattern: replace `!hasAttemptedAuditResume` with `resumeCount < MAX_RESUMES`. After firing:
- Increment `resumeCount`
- Reset `extractionCompleteAt = null` so the 20s timer re-arms
- Friendly message: `addMessage(`Finalizing analysis... (continuation ${resumeCount})`)`

### 4. Add max-resume error

After the stall detection blocks but before the completion check, add:
```typescript
if (resumeCount >= MAX_RESUMES) {
  // Check for partial results before throwing
  // (existing partial results fallback at line 331 handles this)
  throw new Error('Processing exceeded maximum resume attempts');
}
```

### 5. Progress high-water mark

Add a wrapper around `setStepProgress` calls inside the polling loop to track the maximum value seen:
```typescript
let highWaterProgress: Record<string, number> = {};
const setStepProgressHWM = (step: string, pct: number) => {
  const prev = highWaterProgress[step] || 0;
  if (pct >= prev) {
    highWaterProgress[step] = pct;
    setStepProgress(step as any, pct);
  }
};
```
Replace `setStepProgress` calls inside `pollForResults` with `setStepProgressHWM`.

### 6. No backend changes

The backend already:
- Generates a new `pipeline_run_id` on each resume call
- Picks up from the last persisted batch
- Gracefully stops superseded runs

## Summary of behavior

```text
Poll loop iteration:
  1. Read session from DB
  2. Update UI step/progress (high-water mark)
  3. If extracting + batch count stalled > 30s + resumeCount < 20:
     → fire resume, increment counter, reset stall timer
  4. If extraction_complete + stuck > 20s + resumeCount < 20:
     → fire resume, increment counter, reset timer
  5. If completed → return results
  6. If error → throw
  7. If resumeCount >= 20 → throw (falls to partial results handler)
```

