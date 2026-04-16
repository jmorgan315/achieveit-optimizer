

## Plan: Fix "Auth session missing" on invite link landing

### Diagnosis (answers to your three questions)

**(1) Does the page wait for `PASSWORD_RECOVERY` before showing the form?**
No. Current `ResetPasswordPage` (lines 26-58) renders the form as soon as `checkingSession` flips to `false`. That happens via either:
- `onAuthStateChange` firing `PASSWORD_RECOVERY`/`SIGNED_IN` (good path), OR
- A 1.5s `setTimeout` fallback that flips `checkingSession=false` regardless of session state, as long as a token *string* is present in the hash.

The 1.5s fallback is too short and doesn't actually verify a session exists — it just checks the hash contains `access_token`. So on slow networks the form renders, the user types, submits, and `updateUser` fails with `Auth session missing` because the token-exchange hasn't completed.

**(2) Does Supabase auto-exchange the hash token?**
Yes — `detectSessionInUrl` defaults to `true` and our client (`src/integrations/supabase/client.ts`) doesn't override it. The SDK parses the hash on init and exchanges it asynchronously, firing `SIGNED_IN` (and `PASSWORD_RECOVERY` for recovery links) when done. **No explicit call needed.** But the page must *wait* for that event, not race it.

**(3) Secondary bug found in `useAuth.ts` (lines 96-100):**
```ts
if (_event === 'PASSWORD_RECOVERY') {
  navigate('/reset-password');
}
```
When the user is already on `/reset-password`, this triggers a re-navigation that can remount `ResetPasswordPage`, blowing away its local `checkingSession` state mid-token-exchange. Needs a guard: only navigate if not already there.

### The fix

**File 1: `src/pages/ResetPasswordPage.tsx`** — proper auth-readiness gate:
- On mount, render loading state ("Setting up your account…") with spinner.
- Set up `onAuthStateChange` listener FIRST (before any async work, per Supabase best practice).
- Then call `supabase.auth.getSession()` to confirm if a session already exists (handles the case where exchange completed before the listener attached).
- Transition to **form state** when:
  - `PASSWORD_RECOVERY` or `SIGNED_IN` event fires with a session, OR
  - `getSession()` returns a non-null session.
- Transition to **expired state** when:
  - Hash contains `error=` / `error_code=otp_expired` (immediate), OR
  - 5-second timeout elapses with no session established, OR
  - `updateUser` fails with `Auth session missing` (defensive).
- Keep the existing expired-link UI (heading + two buttons).
- Keep `first_login_at` write after successful `updateUser`.

**File 2: `src/hooks/useAuth.ts`** — guard the auto-navigate to prevent remount race:
- Change the `PASSWORD_RECOVERY` handler to only `navigate('/reset-password')` if `window.location.pathname !== '/reset-password'`. Prevents the re-mount that interrupts token exchange.

### Files affected
| File | Change |
|------|--------|
| `src/pages/ResetPasswordPage.tsx` | Replace 1.5s timer with proper readiness gate: listener-first, `getSession()` check, 5s expired fallback |
| `src/hooks/useAuth.ts` | Guard `navigate('/reset-password')` to skip if already on that route |

### What this does NOT change
- Supabase client config (`detectSessionInUrl` stays at default `true` — works correctly).
- The expired-link UI, button labels, or routes (already correct).
- `useAuth.translateAuthError` mappings (still active for other surfaces).
- Any edge function or DB code.

### Test scenarios after fix
1. Fresh invite link → loading state → form appears within ~1s → set password → success.
2. Expired/reused invite link (hash has `error_code=otp_expired`) → expired-link UI immediately.
3. Slow network simulation → loading state holds up to 5s → form appears once exchange completes (no premature render).
4. Truly invalid link (no hash, no session) → expired-link UI after 5s.
5. Already-logged-in user clicks recovery link → form appears (SIGNED_IN already true via `getSession()`).

