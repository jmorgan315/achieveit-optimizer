

## Analysis: Invite Link Flow

**Current state:** There's a gap. Here's what happens today:

1. `invite-user` edge function calls `adminClient.auth.admin.inviteUserByEmail(email)` — this sends an invite email with a link
2. Supabase's default invite link redirects to the **site URL** (project root `/`) with a `type=invite` token in the URL hash
3. The app's `onAuthStateChange` in `useAuth.ts` fires, but it doesn't check for `PASSWORD_RECOVERY` or `INITIAL_SESSION` events — it just runs the normal profile check
4. The user gets auto-logged in (Supabase processes the token automatically), but **never gets prompted to set a password**
5. The `/reset-password` page exists but is only linked from the "Forgot password" flow — invite users are never sent there

**The `/reset-password` page already has the right UI** — it calls `supabase.auth.updateUser({ password })`. We just need to route invited users to it.

## Plan: Wire Invite Link to Password Setup

### File: `supabase/config.toml`
- No changes needed. The `inviteUserByEmail` API uses the project's site URL by default. We need to configure a redirect URL in the invite call instead.

### File: `supabase/functions/invite-user/index.ts`
- Add `redirectTo` option to the `inviteUserByEmail` call pointing to `${siteUrl}/reset-password` so invited users land directly on the password form
- Get `siteUrl` from the request origin header or a configured value

### File: `src/pages/ResetPasswordPage.tsx`
- Detect whether this is an invite flow vs password reset (check URL hash for `type=invite` or listen for auth event)
- Adjust title/description: "Welcome! Set your password" for invites vs "Set New Password" for resets
- No logic changes needed — `updateUser({ password })` works for both flows

### File: `src/hooks/useAuth.ts`
- In `onAuthStateChange`, detect `PASSWORD_RECOVERY` event (Supabase fires this for both reset and invite token exchanges)
- When detected, redirect to `/reset-password` so the user sees the form instead of the home page
- This handles the case where the token is exchanged at `/` and the user needs to be routed

### Summary of changes

| File | Change |
|------|--------|
| `supabase/functions/invite-user/index.ts` | Add `redirectTo` to invite call |
| `src/hooks/useAuth.ts` | Detect `PASSWORD_RECOVERY` event, redirect to `/reset-password` |
| `src/pages/ResetPasswordPage.tsx` | Context-aware title for invite vs reset |

