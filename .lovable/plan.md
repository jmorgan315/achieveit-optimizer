

# Fix: Deduplicate Activity Log Entries During Polling

## Problem
The polling loop in `FileUploadStep.tsx` (line 195-222) calls `addMessage()` on every 3-second poll, even when `current_step` hasn't changed. This creates 45+ duplicate entries.

## Solution

**File**: `src/components/steps/FileUploadStep.tsx`

Track the last reported step in a `useRef` and only call `addMessage` when the step changes. Replace the polling step-update block (lines 211-222):

```typescript
// Before the polling loop, add a ref to track last step
let lastReportedStep = '';

// Inside the loop, replace the current block:
const step = (session as any).current_step as string;
if (step && step !== lastReportedStep) {
  lastReportedStep = step;
  if (step === 'classifying') {
    setStepProgress('classify', 50);
    addMessage('Classifying document structure...');
  } else if (step === 'extracting') {
    setStepProgress('extract', 50);
    addMessage('Extracting plan items...');
  } else if (step === 'validating') {
    setStepProgress('validate', 50);
    addMessage('Auditing and validating...');
  }
}
```

This ensures each pipeline step produces exactly one activity log entry, regardless of how many times the session is polled. The activity log will show ~5 clean entries instead of 45+.

| File | Change |
|------|--------|
| `src/components/steps/FileUploadStep.tsx` | Add `lastReportedStep` tracking in `pollForResults` to deduplicate messages |

