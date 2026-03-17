

# Fix: Session Lifecycle and API Call Logging

## Root Cause (confirmed)

`api_call_logs.session_id` has a **foreign key** to `processing_sessions.id`. The frontend generates a UUID in `ensureSessionId()` but **never inserts a row** into `processing_sessions`. Edge functions call `ensureSession(incomingSessionId)` which, when a sessionId IS provided, just returns it without creating the row. Result: every `logApiCall` insert fails silently with an FK violation.

`lookup-organization` works because it sometimes gets called without a sessionId, causing `ensureSession` to create a NEW row with a different ID — which is a second bug (session ID mismatch).

## Changes

### 1. `src/pages/Index.tsx` — Create session row immediately

In `ensureSessionId()`, after generating the UUID, immediately insert a row into `processing_sessions` via the Supabase client. Add `console.log` for the generated ID. Also add logging after the org profile update to confirm row match count.

```ts
const ensureSessionId = () => {
  if (!state.sessionId) {
    const id = crypto.randomUUID();
    console.log('[Session] Creating new session:', id);
    setSessionId(id);
    // Insert the row NOW so edge functions can reference it
    supabase.from('processing_sessions').insert({ id, status: 'in_progress' })
      .then(({ error }) => {
        if (error) console.error('[Session] Failed to create session row:', error);
        else console.log('[Session] Row created:', id);
      });
    return id;
  }
  console.log('[Session] Reusing existing session:', state.sessionId);
  return state.sessionId;
};
```

In `handleOrgProfileComplete`, log the update result and warn if 0 rows matched.

### 2. `supabase/functions/_shared/logging.ts` — Make `ensureSession` safe, surface errors

Change `ensureSession`: when a sessionId IS provided, do an **upsert** (insert with `onConflict: 'id'`) so that if the row already exists it's a no-op, but if it somehow doesn't exist, it gets created. This is a safety net.

Change `logApiCall`: log the full error object including `details`, `hint`, `code` — not just `error.message`. Add the session_id and edge_function to the error log for context.

```ts
export async function logApiCall(entry: ApiCallLogEntry): Promise<void> {
  try {
    const client = getClient();
    const { error } = await client.from("api_call_logs").insert(entry);
    if (error) {
      console.error("[Logging] Failed to insert api_call_log:", {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        session_id: entry.session_id,
        edge_function: entry.edge_function,
        step_label: entry.step_label,
      });
    }
  } catch (e) {
    console.error("[Logging] logApiCall exception:", e);
  }
}
```

### 3. `src/components/steps/FileUploadStep.tsx` — Add debug logs, warn on 0 rows

- In `updateSessionRow`: log before/after, warn if the update response suggests 0 rows affected.
- In `aggregateAndUpdateSession`: log the aggregated totals before updating.
- Before `extract-plan-items` fetch: `console.log('[FileUpload] Calling extract-plan-items with sessionId:', sessionId)`
- Before `extract-plan-vision` fetch: same pattern.
- Before `parse-pdf` fetch: same pattern.

### 4. `supabase/functions/extract-plan-items/index.ts` — Add debug log at top

Add `console.log('[extract-plan-items] Received sessionId:', incomingSessionId)` right after destructuring the request body, and `console.log('[extract-plan-items] Resolved sessionId:', sessionId)` after `ensureSession`.

### 5. `supabase/functions/lookup-organization/index.ts` — Same debug log

Add `console.log('[lookup-organization] Received sessionId:', incomingSessionId)` after destructuring.

### Files to modify

| File | What |
|------|------|
| `src/pages/Index.tsx` | Insert `processing_sessions` row in `ensureSessionId()`, log org update result |
| `supabase/functions/_shared/logging.ts` | Upsert in `ensureSession`, surface full errors in `logApiCall` |
| `src/components/steps/FileUploadStep.tsx` | Debug console.logs before each fetch, warn on 0-row updates |
| `supabase/functions/extract-plan-items/index.ts` | Debug console.log for sessionId |
| `supabase/functions/lookup-organization/index.ts` | Debug console.log for sessionId |
| `supabase/functions/parse-pdf/index.ts` | Debug console.log for sessionId |

