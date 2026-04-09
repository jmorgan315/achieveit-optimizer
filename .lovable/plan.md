

## Fix: `user` Missing from `ensureSessionId` Closure

### Root Cause

Line 132 of `Index.tsx`:
```typescript
}, [state.sessionId, setSessionId]);
```

`user` is **not** in the `useCallback` dependency array. Here's the race:

1. Component mounts → `user` is `null` → `useCallback` creates `ensureSessionId` capturing `user = null`
2. Auth loads → `user` becomes the real user → re-render fires
3. But `useCallback` deps (`state.sessionId`, `setSessionId`) haven't changed, so **the same function with the stale `null` user closure is returned**
4. User clicks "Scan" → `ensureSessionId()` runs → `user!.id` throws `TypeError` (can't read `.id` of null)
5. But line 118 already set `sessionIdRef.current = id` **before** the crash, so the session ID is "committed" in memory
6. The thrown error propagates but doesn't prevent edge functions from being called with that session ID
7. Edge functions call `ensureSession(id)` → creates the row **without `user_id`**
8. The frontend upsert at line 121 never executed (it crashed before reaching `supabase.from`)

The earlier sessions (14:20, 13:55) had `user_id` because `state.sessionId` or `sessionIdRef.current` happened to be set in a render where deps changed, causing `useCallback` to re-capture a non-null `user`.

### Fix

**`src/pages/Index.tsx`** — Add `user` to the dependency array:

```typescript
}, [state.sessionId, setSessionId, user]);
```

Also add a guard so the upsert gracefully handles a null user instead of crashing:

```typescript
sessionPromiseRef.current = (async () => {
  const id = crypto.randomUUID();
  sessionIdRef.current = id;
  console.log('[Session] Creating new session:', id);
  setSessionId(id);
  const upsertPayload: Record<string, unknown> = { id, status: 'in_progress' };
  if (user?.id) upsertPayload.user_id = user.id;
  const { error } = await supabase.from('processing_sessions').upsert(
    upsertPayload, { onConflict: 'id' }
  );
  if (error) console.error('[Session] Failed to create session row:', error);
  else console.log('[Session] Row created successfully:', id);
  return id;
})();
```

And backfill the two null sessions:

```sql
UPDATE processing_sessions 
SET user_id = 'ee58c766-cc3c-4196-a404-1ed9ebf3847d' 
WHERE user_id IS NULL AND document_name IS NOT NULL;
```

### Files to Modify

| File | Change |
|------|--------|
| `src/pages/Index.tsx` | Add `user` to `useCallback` deps; add null guard on `user?.id` |
| Migration | Backfill 2 null `user_id` rows |

