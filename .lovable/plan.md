

## Fix: invite-user Edge Function failing

### Problem
The `invite-user` function is missing from `supabase/config.toml`. Without a `verify_jwt = false` entry, the platform's default JWT verification rejects the request before the function code even runs — producing the generic "Failed to send a request to the Edge Function" error.

The function already handles its own authentication internally (verifies the caller's JWT and checks admin status), so platform-level JWT verification is unnecessary and redundant.

### Fix

**File: `supabase/config.toml`** — Add the missing function block:

```toml
[functions.invite-user]
verify_jwt = false
```

Then redeploy the `invite-user` edge function.

### Files to modify

| File | Change |
|------|--------|
| `supabase/config.toml` | Add `[functions.invite-user]` with `verify_jwt = false` |

