

## Plan: Route Invites & Password Resets Through Resend

### Answer to Q1: Supabase SMTP + Resend
**Not directly configurable from Lovable.** Lovable Cloud doesn't expose Supabase Auth's SMTP settings in the UI — that lives in the Supabase dashboard's Authentication → Email settings, which Cloud projects don't surface. So **option 2 (your proposed approach) is the path**: keep using `generateLink()` to mint the secure tokens, then ship the email ourselves via the Resend gateway.

This is actually cleaner than SMTP — same gateway as `send-notification`, consistent branding, all email logic in one place.

### Architecture

Create a shared template helper, refactor both edge functions to use `generateLink()` + Resend.

```
supabase/functions/
├── _shared/
│   └── auth-emails.ts          NEW — shared Resend sender + HTML templates
├── invite-user/index.ts        EDIT — use generateLink({type:"invite"}) + sendAuthEmail()
├── admin-user-actions/index.ts EDIT — same for invite/recovery actions
└── send-notification/index.ts  unchanged (pattern reference)
```

### 1. New `_shared/auth-emails.ts`

Exports:
- `sendAuthEmail({ to, subject, html })` — POSTs to `https://connector-gateway.lovable.dev/resend/emails` with `LOVABLE_API_KEY` + `RESEND_API_KEY` headers, `from: "AchieveIt <onboarding@resend.dev>"`. Returns `{ ok, id?, error? }`.
- `buildInviteEmail(actionLink, recipientEmail)` → `{ subject, html }` — "You've been invited to AchieveIt", CTA "Accept invitation" linking to `actionLink`.
- `buildRecoveryEmail(actionLink, recipientEmail)` → `{ subject, html }` — "Reset your AchieveIt password", CTA "Reset password".
- Same brand styling as `send-notification` (white card, green CTA `#10b981`, footer note).
- `escapeHtml` helper.

### 2. Refactor `invite-user/index.ts`

Replace:
```ts
adminClient.auth.admin.inviteUserByEmail(email, { redirectTo })
```
with:
```ts
const { data, error } = await adminClient.auth.admin.generateLink({
  type: "invite",
  email,
  options: { redirectTo: `${origin}/reset-password` },
});
// data.properties.action_link → secure tokenized URL
const { subject, html } = buildInviteEmail(data.properties.action_link, email);
const send = await sendAuthEmail({ to: email, subject, html });
if (!send.ok) return json({ error: `Email send failed: ${send.error}` }, 502);
```
- Keep the `invited_at` profile update (uses `data.user.id` — `generateLink` returns this when creating a new user).
- Keep the activity log entry.
- Keep super_admin gate and @achieveit.com domain check.

### 3. Refactor `admin-user-actions/index.ts`

**`reset_password` action**: Currently calls `generateLink({type:"recovery"})` *and* `resetPasswordForEmail()` (the second call is what actually sends mail). Replace with:
```ts
const { data, error } = await adminClient.auth.admin.generateLink({
  type: "recovery",
  email,
  options: { redirectTo: `${origin}/reset-password` },
});
const { subject, html } = buildRecoveryEmail(data.properties.action_link, email);
await sendAuthEmail({ to: email, subject, html });
```

**`resend_invite` action**: Currently calls `generateLink({type:"invite"})` but never sends — that's a latent bug (admins clicking "Resend Invite" today probably get nothing). Same fix: capture `action_link`, send via Resend.

`delete_user` action stays untouched.

### 4. Self-service password reset (LoginPage / "Forgot password")

Need to check: does the app have a user-initiated "Forgot password?" flow that calls `supabase.auth.resetPasswordForEmail()` directly from the client? If so, that's the one place where Supabase's default email still ships. Two options:
- **(a)** Leave as-is (relies on Supabase's built-in recovery email — works but inconsistent branding).
- **(b)** Create a new `request-password-reset` edge function (no auth required, rate-limited by email) that does the same `generateLink` + Resend dance, and have the login page call that instead.

I'll check `LoginPage.tsx` for an existing forgot-password call site during implementation. If present, I'll wire it to a new `request-password-reset` function for consistency. If not, skip it.

### 5. Config

Add to `supabase/config.toml` if a new function is created:
```toml
[functions.request-password-reset]
verify_jwt = false
```
The two existing functions already have `verify_jwt = false`.

### Trade-offs & notes

- **Sandbox sender caveat unchanged**: `onboarding@resend.dev` only delivers to your Resend account email. Same limitation as `send-notification` — verify `achieveit.com` in Resend later to send to all users.
- **Token validity**: `generateLink` returns links valid for the same TTL as the built-in flow (~24h invite, ~1h recovery — set in Supabase auth config).
- **Failure mode**: If Resend send fails, the user is created/the recovery token is minted but no email arrives. We return a 502 so the admin sees it and can retry via "Resend Invite".
- **No DB migration needed.**

### Files changed

| File | Change |
|------|--------|
| `supabase/functions/_shared/auth-emails.ts` | New — Resend sender + invite/recovery HTML templates |
| `supabase/functions/invite-user/index.ts` | Swap `inviteUserByEmail` → `generateLink` + `sendAuthEmail` |
| `supabase/functions/admin-user-actions/index.ts` | Same swap for `reset_password` and `resend_invite` actions |
| `supabase/functions/request-password-reset/index.ts` | New, **only if** LoginPage has a forgot-password flow |
| `supabase/config.toml` | Add `verify_jwt = false` for new function (if created) |
| `src/components/LoginPage.tsx` | Wire forgot-password to new function (if applicable) |

