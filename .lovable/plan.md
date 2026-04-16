

## Plan: Two onboarding error fixes

### Diagnosis

**(1) Email rate limit on sign-up** — Yes, this is Supabase's default auth SMTP rate limit (~2-4/hour on shared sender). Cannot be raised via Lovable Cloud config — only resolved by configuring a verified email domain (which the user can't do yet, no DNS access). So the right fix right now is a friendly error message at the UI layer.

The error currently surfaces in `LoginPage.tsx` via `setError(result.error.message)` (line ~62), which displays the raw Supabase string `"email rate limit exceeded"`. We intercept it in `useAuth.signUp` before returning and translate it.

**(2) Auth Session Missing** — Found the surface. `ResetPasswordPage.tsx` calls `supabase.auth.updateUser({ password })` (line 37) **without first verifying that a session was established from the URL hash tokens**. If the invite/recovery link is expired, malformed, or already consumed (clicked twice), Supabase returns the cryptic `"Auth session missing!"` error. There's no pre-check, no friendly message, and no path back to login.

A secondary surface: `useAuth` swallows nothing here — but `onAuthStateChange` only fires `PASSWORD_RECOVERY` on a valid token. If the token has expired, no event fires, the page just sits there, then `updateUser` fails.

### Changes

**File 1: `src/hooks/useAuth.ts`** — translate auth errors in both `signIn` and `signUp` (and pass through `resetPassword`):

Add a small helper `translateAuthError(message)`:
- `email rate limit exceeded` / `over_email_send_rate_limit` → "Too many sign-up attempts right now. Please wait a few minutes and try again, or ask your administrator to send you an invite link."
- `auth session missing` / `session_not_found` → "Your link has expired or was already used. Request a new one or sign in with your email and password."
- `invalid login credentials` → "Incorrect email or password."
- `user already registered` → "An account with this email already exists. Try signing in instead."
- `email not confirmed` → "Please check your email and confirm your address before signing in."
- Default: pass message through.

Apply in `signIn`, `signUp`, `resetPassword` return paths.

**File 2: `src/pages/ResetPasswordPage.tsx`** — add session detection + expired-link handling:

1. On mount, check URL hash for `error=` / `error_code=otp_expired` / `error_description=` (Supabase puts these there when a link is bad). If present → render expired-link state immediately.
2. Wait briefly for `onAuthStateChange` to fire `PASSWORD_RECOVERY` / `SIGNED_IN`. If after ~1.5s no session exists AND no recovery token in hash → render expired-link state.
3. In `handleSubmit`, if `updateUser` returns an error containing `session` / `Auth session missing` → switch to expired-link state instead of showing raw error.
4. Expired-link state shows:
   - Heading: "This link has expired"
   - Message: "Your invite or password reset link is no longer valid. Links expire after a short time and can only be used once."
   - Two buttons: **"Request a new link"** → `navigate('/')` (login page has Forgot password) and **"Back to sign in"** → `navigate('/')`.

**File 3: `src/components/LoginPage.tsx`** — minor: when `error` contains "rate limit" or "too many", also surface a hint pointing to "ask your administrator for an invite link" (already handled by useAuth translation, just verify display works — no code change beyond what propagates from useAuth).

### Files affected
| File | Change |
|------|--------|
| `src/hooks/useAuth.ts` | Add `translateAuthError` helper, apply in signIn/signUp/resetPassword |
| `src/pages/ResetPasswordPage.tsx` | Detect missing/expired session, render expired-link UI with recovery actions |

No DB changes. No edge function changes. No memory updates needed — both are pure UI/error-handling refinements consistent with existing patterns (useAuth already wraps Supabase errors in `{error: {message}}`).

### What this does NOT do
- Does NOT increase the Supabase rate limit (impossible without domain setup).
- Does NOT auto-fall-back from sign-up to invite-link generation (separate flow; the user can use admin "Copy Invite Link" already).
- Does NOT touch the working `Copy Invite Link` admin flow.

