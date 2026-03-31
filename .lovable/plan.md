

# Fix: Polling Race Condition + Page Range State

Two targeted fixes to prevent the issues seen in the last run.

---

## Fix 1: Polling resilience for transient error status

**File**: `src/components/steps/FileUploadStep.tsx` — `pollForResults` function (lines 322-325)

**Problem**: When the poller sees `status === 'error'`, it immediately throws. But during a resume cycle, the server briefly writes `error` before overwriting with a successful result. The client catches that transient state and abandons the run.

**Fix**: Track whether the session has made progress (items extracted or step advanced past `classifying`). If progress was observed and the status is `error`, allow up to 3 additional grace polls (9 seconds) before giving up. This gives the resume mechanism time to overwrite the error.

```
Add tracking variables at the top of pollForResults:
  let hadProgress = false;
  let errorGracePolls = 0;
  const MAX_ERROR_GRACE = 3;

In the polling loop, after reading session:
  - If step is 'extracting'/'extraction_complete'/'validating' or stepResults has items → set hadProgress = true
  
At the existing error check (line 322-325):
  - If hadProgress && errorGracePolls < MAX_ERROR_GRACE:
    - Increment errorGracePolls
    - Log: "[Polling] Transient error detected, grace poll N/3..."
    - continue (don't throw)
  - Otherwise: throw as before
```

---

## Fix 2: Clear page range on new file upload

**Problem**: The `startPage` and `endPage` state is lifted to `Index.tsx` and reset in `handleStartOver`. However, if a user sets page range values in Step 0, goes through the pipeline, navigates back, and uploads a new file *without* clicking Start Over, the old page range persists and gets applied to the new document.

**File**: `src/pages/Index.tsx`

**Fix**: In the `setUploadedFile` setter or wherever a new file is set, also clear `startPage` and `endPage`. Specifically:
- When `uploadedFile` changes to a new file (not null), reset `startPage` to `''` and `endPage` to `''`
- The simplest approach: create a wrapper `handleNewFileUpload` that sets the file AND clears page range, then pass that to `FileUploadStep` instead of the raw setter

Alternatively, since `OrgProfileStep` owns the Document Scope UI: add an `onFileChange` callback or clear page range inside `FileUploadStep` when a new file is selected.

**File**: `src/components/steps/FileUploadStep.tsx`

In the file selection handler (where `setUploadedFile` is called with a new file), also call the parent's page range reset. Since `setStartPage` and `setEndPage` aren't currently passed to `FileUploadStep`, the cleanest approach is:
- Add an `onNewFileSelected?: () => void` prop to `FileUploadStep`
- Call it when a new file is picked
- In `Index.tsx`, pass `onNewFileSelected={() => { setStartPage(''); setEndPage(''); }}`

---

## Files to modify

| File | Change |
|------|--------|
| `src/components/steps/FileUploadStep.tsx` | Add error grace polling logic; add `onNewFileSelected` prop and call it on file pick |
| `src/pages/Index.tsx` | Pass `onNewFileSelected` that clears `startPage` and `endPage` |

