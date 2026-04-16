

## Root Cause: RLS Rejects the Upsert in UploadIdentifyStep

The DB logs confirm it: **`new row violates row-level security policy for table "processing_sessions"`** on the upsert from `UploadIdentifyStep`.

### What's happening

1. **`ensureSessionId`** (Index.tsx:128) creates the session row via upsert with `{ id, status, user_id }` — this succeeds because the INSERT RLS policy (`user_id = auth.uid()`) is satisfied.

2. **`UploadIdentifyStep.handleContinue`** (line 148) does a second upsert with `{ id, org_name, org_industry, document_name, document_size_bytes }` — **no `user_id` in the payload**. PostgREST evaluates the INSERT RLS policy first (`WITH CHECK: user_id = auth.uid()`). Since `user_id` is absent (null), the check fails. The entire upsert is rejected silently (line 155 just logs the error).

3. **`FileUploadStep`** (lines 249, 804) later calls `.update({ document_name, document_size_bytes }).eq('id', sessionId)` — this uses the UPDATE policy (`USING: user_id = auth.uid()`), which passes because the existing row has the correct `user_id`. So `document_name` gets saved, but `org_name` and `org_industry` are never written.

### Why it worked before

The `UploadIdentifyStep` was introduced or refactored to use `.upsert()`. Before that, org profile data likely flowed through a different code path (OrgProfileStep or the edge function) that didn't have this RLS conflict.

### Fix

**`src/components/steps/UploadIdentifyStep.tsx`** — Change the upsert (line 148) to a `.update().eq('id', sid)`. The row already exists at this point (created by `ensureSessionId`), so an upsert is unnecessary. The UPDATE RLS policy only checks `user_id = auth.uid()` on the existing row, which passes.

```typescript
// Before (fails INSERT RLS — no user_id in payload):
await supabase.from('processing_sessions').upsert({
  id: sid, org_name: ..., org_industry: ..., document_name: ..., document_size_bytes: ...
}, { onConflict: 'id' });

// After (uses UPDATE policy — works correctly):
await supabase.from('processing_sessions')
  .update({ org_name: orgName.trim(), org_industry: industry, document_name: uploadedFile.name, document_size_bytes: uploadedFile.size })
  .eq('id', sid);
```

### Files changed

| File | Change |
|------|--------|
| `src/components/steps/UploadIdentifyStep.tsx` | Change `.upsert()` to `.update().eq('id', sid)` at line 148 |

Single line change. No migration needed, no other files affected.

