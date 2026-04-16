
## Plan: Fix invite link issues on ResetPasswordPage

### Diagnosis

**(1) "Expired" in normal browsers, works in incognito** — Confirmed root cause. When a user already has a Supabase session in localStorage (e.g. they're logged in as themselves in another tab, or have a stale session), the SDK's `detectSessionInUrl` exchange races with the existing session. The `PASSWORD_RECOVERY` event may not fire reliably because the client thinks it's already authenticated, so our 5s readiness gate times out and shows the expired UI. Incognito has no stored session, so the exchange runs cleanly.

**(2) "Request a new link" button does nothing** — Looking at current `ResetPasswordPage.tsx` lines 119-123, both buttons call `navigate('/')`. The likely failure is that after `linkExpired` fires from a Supabase error redirect, the browser URL still has `#error=...&error_code=otp_expired` in the hash. `navigate('/')` updates the path but leaves the hash, and on `/` the `LoginPage` may not re-render or the hash interferes. Also possible: a stale session from the failed exchange leaves the app in an odd state where Index redirects elsewhere.

### The fix

**File: `src/pages/ResetPasswordPage.tsx`**

1. **Pre-mount session clear**: On mount, detect if the hash contains `access_token=`, `type=invite`, `type=recovery`, or `type=magiclink`. If yes AND no error params, call `supabase.auth.signOut({ scope: 'local' })` BEFORE setting up the listener and `getSession()` check. This clears any stale local session without invalidating the recovery token. Use `scope: 'local'` so we don't hit Supabase's signout endpoint (which would also be rate-limited and unnecessary).

2. **Sequencing**: 
   - Detect error hash → expired UI immediately (unchanged).
   - Detect recovery/invite token in hash → `signOut({scope:'local'})` → then attach `onAuthStateChange` listener → then `getSession()` poll → 5s timeout fallback.
   - No token in hash → existing path.

3. **Fix "Request a new link" button**:
   - Create a `goHome()` helper that:
     - Clears the URL hash first: `window.history.replaceState(null, '', '/')`
     - Calls `navigate('/', { replace: true })`
     - 300ms fallback: if `window.location.pathname !== '/'`, do `window.location.href = '/'`
   - Wire both buttons to `goHome()`.

### Files affected
| File | Change |
|------|--------|
| `src/pages/ResetPasswordPage.tsx` | Add local signOut before token exchange; add hash-clearing navigation helper for both buttons |

No changes to `useAuth.ts`, edge functions, DB, or client config.

### What this does NOT change
- The 5s readiness gate, loading UI, or expired-state UI.
- The translation helper in `useAuth`.
- Supabase client config (`detectSessionInUrl` stays default).
- The `Copy Invite Link` admin flow.

### Test scenarios
1. Logged-in user (different account) clicks fresh invite link → local session cleared → new token exchanges → form appears.
2. Same scenario in incognito → still works (no regression).
3. Expired link → expired UI → click "Request a new link" → lands on `/` cleanly with no hash.
4. Expired link → click "Back to sign in" → same clean landing.
