

## Fix: Update CORS headers in invite-user Edge Function

### Problem
The `invite-user` function's CORS `Access-Control-Allow-Headers` only lists `authorization, x-client-info, apikey, content-type`. The Supabase JS client v2 sends additional headers (`x-supabase-client-platform`, `x-supabase-client-platform-version`, `x-supabase-client-runtime`, `x-supabase-client-runtime-version`). The browser's preflight OPTIONS check fails because these headers aren't allowed, blocking the actual POST request.

### Fix

**File: `supabase/functions/invite-user/index.ts`** — Update the CORS headers to include all headers the client sends:

```typescript
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
```

Then redeploy and test the function.

### Files to modify

| File | Change |
|------|--------|
| `supabase/functions/invite-user/index.ts` | Expand CORS allowed headers |

