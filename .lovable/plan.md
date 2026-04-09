

## Fix: Missing `user_id` on Processing Sessions

### Root Cause

A race condition between the frontend and server-side session creation:

1. Frontend (`Index.tsx:121`): upserts `{ id, status, user_id }` with `ignoreDuplicates: true`
2. Server (`_shared/logging.ts:106`): upserts `{ id, status }` (NO `user_id`) with `ignoreDuplicates: true`

If the edge function's `ensureSession` executes first, it creates the row without `user_id`. The frontend upsert then becomes a no-op due to `ignoreDuplicates`, leaving `user_id` permanently null.

### Fix

**1. Change frontend upsert to NOT ignore duplicates** (`src/pages/Index.tsx`)

Replace `ignoreDuplicates: true` with an explicit update so the frontend always wins:

```typescript
const { error } = await supabase
  .from('processing_sessions')
  .upsert(
    { id, status: 'in_progress', user_id: user!.id },
    { onConflict: 'id' }  // removes ignoreDuplicates — will UPDATE on conflict
  );
```

This way, even if the server created the row first without `user_id`, the frontend upsert overwrites it with the correct `user_id`.

**2. Backfill existing null sessions** (one-time migration)

For the Apr 8-9 sessions that already have `user_id: null`, run a migration to set them based on the authenticated user who likely created them. Since there's only one active user (`ee58c766-...`), backfill all null rows:

```sql
UPDATE processing_sessions 
SET user_id = 'ee58c766-cc3c-4196-a404-1ed9ebf3847d' 
WHERE user_id IS NULL 
  AND document_name IS NOT NULL;
```

### Files to Modify

| File | Change |
|------|--------|
| `src/pages/Index.tsx` | Remove `ignoreDuplicates: true` from session upsert (line 121) |
| Migration | Backfill null `user_id` rows |

