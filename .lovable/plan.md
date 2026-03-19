

# Fix Pipeline Timeout: Parallel Agents + Async Polling

## Problem
The `process-plan` edge function takes ~170s, exceeding the browser connection timeout (~120s). The pipeline completes on the server but the frontend never receives the response.

## Change 1: Parallelize Agents 2 & 3

**File**: `supabase/functions/process-plan/index.ts` (lines 511-584)

Run `audit-completeness` and `validate-hierarchy` concurrently with `Promise.allSettled`. They are independent — saves ~18-20s.

```typescript
const [auditSettled, validateSettled] = await Promise.allSettled([
  (async () => { /* audit logic */ })(),
  (async () => { /* validate logic */ })(),
]);
// Extract results from settled promises, keep same error handling
```

## Change 2: Async Processing with Polling

### 2a. Database Migration

Add two columns to `processing_sessions`:
- `current_step` (text, default `'queued'`) — tracks pipeline progress
- `step_results` (jsonb, nullable) — stores final pipeline output

### 2b. Edge Function: Fire-and-Forget Pattern

**File**: `supabase/functions/process-plan/index.ts`

Restructure `serve()` handler:
1. Parse request, ensure session, return `{ success: true, sessionId }` immediately
2. Run the full pipeline in a non-awaited async function (Supabase Edge Functions keep the isolate alive after responding — the function already runs ~170s today)
3. At each checkpoint, update `processing_sessions` row:
   - After Agent 0: `current_step = 'classifying'`, save classification
   - After Agent 1: `current_step = 'extracting'`, save item count
   - After Agents 2+3: `current_step = 'validating'`
   - On completion: `status = 'completed'`, `current_step = 'complete'`, `step_results = { full result payload }`
   - On error: `status = 'error'`, `step_results = { error details }`

### 2c. Frontend: Poll for Results

**File**: `src/components/steps/FileUploadStep.tsx`

Replace the single long `fetch()` in both `extractWithVisionPipeline` and `extractPlanItemsWithAI`:

1. `POST` to `process-plan` — returns immediately with `{ sessionId }`
2. Start a polling loop (every 3s) querying `processing_sessions` by sessionId
3. Map `current_step` values to `ProcessingStep` UI states:
   - `'classifying'` → `setStepProgress('classify', 50)`
   - `'extracting'` → `setStepProgress('extract', 50)`
   - `'validating'` → `setStepProgress('validate', 50)`
   - `'completed'` → read `step_results`, process as before
   - `'error'` → show error from `step_results`
4. On `status = 'completed'`, parse `step_results` exactly as the current `result` response is parsed (same fields: `data`, `totalItems`, `corrections`, `sessionConfidence`, etc.)

### 2d. Enable Realtime (optional optimization)

Add `processing_sessions` to realtime publication so a future iteration can use subscriptions instead of polling. Not required for this change.

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.processing_sessions;
```

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/process-plan/index.ts` | Parallel agents, return-early + background processing, DB progress updates |
| `src/components/steps/FileUploadStep.tsx` | Replace long fetch with POST + poll loop |
| Database migration | Add `current_step` and `step_results` columns |

