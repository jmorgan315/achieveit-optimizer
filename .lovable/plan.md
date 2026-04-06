

# Fix: Resume Polling for In-Progress Sessions + Homepage Auto-Refresh

## Bug 1: In-progress sessions trigger handleFileUpload instead of just polling

**Problem**: When clicking an in-progress session from RecentSessionsPage, `handleSelectSession` sets `currentStep = 2` which renders `FileUploadStep` with `autoStart` always true. The autoStart effect fires `handleFileUpload`, which tries to re-upload and re-process the file (which doesn't even exist in memory). The backend is already running — we just need to poll.

**Fix**:

### `src/pages/Index.tsx`
- Add a `resumePollingOnly` state flag (default `false`)
- In `handleSelectSession` for `in_progress` sessions: set `resumePollingOnly = true`
- In `handleNewImport` / `handleStartOver`: reset `resumePollingOnly = false`
- Pass `resumePollingOnly` as a prop to `FileUploadStep` instead of hardcoding `autoStart`
- Change `autoStart` to only be true when `resumePollingOnly` is false (i.e., coming from Screen 2)

### `src/components/steps/FileUploadStep.tsx`
- Add `resumePollingOnly?: boolean` prop
- Add a new `useEffect`: when `resumePollingOnly` is true and `sessionId` exists, skip `handleFileUpload` entirely — go straight into `pollForResults(sessionId)`, show the processing overlay, and handle results the same way the pipeline completion path does
- The existing `autoStart` effect remains unchanged for the normal flow (new import from Screen 2)

## Bug 2: RecentSessionsPage doesn't auto-refresh for in-progress sessions

**Problem**: The sessions list fetches once on mount and never updates. If a session is processing, the user must manually refresh to see status changes.

**Fix**:

### `src/components/RecentSessionsPage.tsx`
- Extract `fetchSessions` out of the `useEffect` so it can be called repeatedly
- Add a polling `useEffect`: if any session in state has `status === 'in_progress'`, set a 10-second interval that re-fetches sessions
- When no sessions are in-progress, clear the interval
- Clean up on unmount

## Files

| File | Change |
|------|--------|
| `src/pages/Index.tsx` | Add `resumePollingOnly` state; pass to FileUploadStep; set on session resume |
| `src/components/steps/FileUploadStep.tsx` | Add `resumePollingOnly` prop; new useEffect for poll-only resume path |
| `src/components/RecentSessionsPage.tsx` | Add 10s polling interval when any session is in_progress |

