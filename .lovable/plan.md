

## Plan: Revert Auth Emails to Supabase Built-in (Keep Resend for Notifications)

### Strategy
Revert invite + password reset flows to Supabase's built-in email senders (which work for any `@achieveit.com` recipient via Supabase's default SMTP). Keep `send-notification` on Resend (only emails session owner = jmorgan, works in sandbox). Keep `_shared/auth-emails.ts` dormant for future re-activation. Add Path B logging hygiene everywhere.

### Changes

**1. `supabase/functions/invite-user/index.ts`**
- Replace `generateLink({type:"invite"})` + `sendAuthEmail` with:
  ```ts
  const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/reset-password`,
  });
  ```
- `data.user.id` still available for `invited_at` update + activity log.
- Remove the `buildInviteEmail` / `sendAuthEmail` imports.
- Add `console.error("[invite-user] ...", error)` before each non-2xx return.

**2. `supabase/functions/admin-user-actions/index.ts`**
- **`reset_password`**: Replace `generateLink({type:"recovery"})` + `sendAuthEmail` with:
  ```ts
  const { error } = await adminClient.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${origin}/reset-password` },
  });
  ```
  Wait — `generateLink` alone doesn't send. Need `resetPasswordForEmail` on a non-admin client. Use the anon `callerClient` pattern, or simpler: use `adminClient.auth.resetPasswordForEmail(email, { redirectTo })` (works on the auth namespace, not admin). Will verify the exact API during implementation — fallback is to construct an anon client and call `auth.resetPasswordForEmail`.
- **`resend_invite`**: Same swap — use `inviteUserByEmail(email, { redirectTo })`. Keep `invited_at` update + activity log.
- **`delete_user`**: Untouched.
- Add `console.error` before each non-2xx return.

**3. `supabase/functions/send-notification/index.ts`**
- No changes. Stays on Resend.

**4. `supabase/functions/request-password-reset/index.ts`**
- Self-service forgot-password. Currently uses Resend. Two options:
  - **(a)** Revert to Supabase built-in: use anon client `auth.resetPasswordForEmail(email, { redirectTo })`. Keeps the rate limit + always-200 enumeration protection.
  - **(b)** Leave on Resend — but it would only deliver to jmorgan, breaking forgot-password for anyone else.
- Going with **(a)** — consistent with the revert intent. Add `console.error` for failures (still return 200 to client).

**5. `src/hooks/useAuth.ts`**
- `resetPassword()` currently invokes `request-password-reset` edge function. Keep that wiring — the edge function itself now uses Supabase built-in, so the client doesn't need to change.

**6. `_shared/auth-emails.ts` + `FROM_ADDRESS`**
- Keep file as-is. No imports from invite-user / admin-user-actions / request-password-reset after revert. Still imported by `send-notification`.

**7. `src/pages/admin/UsersPage.tsx`** (Path B UI)
- Surface specific error text from edge function responses in toasts (e.g., "Email send failed: …") instead of generic "Failed to invite user". Read `error` field from response body when non-2xx.

**8. `supabase/config.toml`**
- No changes needed. `request-password-reset` keeps `verify_jwt = false`.

### Files changed

| File | Change |
|------|--------|
| `supabase/functions/invite-user/index.ts` | Revert to `inviteUserByEmail`; add console.error logging |
| `supabase/functions/admin-user-actions/index.ts` | Revert `reset_password` + `resend_invite` to Supabase built-in; add logging |
| `supabase/functions/request-password-reset/index.ts` | Revert to anon client `resetPasswordForEmail`; keep rate limit + enumeration protection; add server-side logging |
| `src/pages/admin/UsersPage.tsx` | Surface edge function error details in admin toasts |
| `supabase/functions/send-notification/index.ts` | Untouched |
| `supabase/functions/_shared/auth-emails.ts` | Untouched (dormant for future re-activation) |
| `.lovable/memory/features/auth-email-routing.md` | Update to reflect: notifications on Resend, auth emails on Supabase default until domain verified |
| `.lovable/memory/index.md` | Update reference summary line |

### Trade-offs
- **Branding regression**: Invite + password reset emails revert to Supabase's plain default templates (no green AchieveIt CTA). Acceptable until domain verification.
- **Sender**: Supabase default emails ship from `noreply@mail.app.supabase.io` — functional but unbranded.
- **Re-activation path**: Once `achieveit.com` is verified in Resend, swap back to the `generateLink` + `sendAuthEmail` pattern (already in git history) and update `FROM_ADDRESS` to `notify@achieveit.com`.

