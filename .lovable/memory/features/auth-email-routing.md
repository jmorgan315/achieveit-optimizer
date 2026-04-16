---
name: Auth Email Routing
description: Notifications go through Resend; invites and password resets temporarily reverted to Supabase built-in until achieveit.com domain is verified
type: feature
---
**Current state (sandbox):** Auth-related emails (invites, admin-triggered password resets, self-service "Forgot password") are sent via **Supabase's built-in default email templates**. Only `send-notification` (import completion) ships through the Resend connector gateway, because it only ever emails the session owner (jmorgan, the Resend account owner) which works under Resend's sandbox sender restriction.

**Why reverted:** The Resend sandbox sender `onboarding@resend.dev` only delivers to the Resend account owner. Routing invites/resets through Resend broke delivery for every other @achieveit.com user (HTTP 403 `validation_error` from the gateway). Supabase's default email works for any @achieveit.com recipient.

**Functions involved:**
- `invite-user` — uses `adminClient.auth.admin.inviteUserByEmail(email, { redirectTo })` (Supabase default)
- `admin-user-actions` — `reset_password` uses anon client `auth.resetPasswordForEmail`; `resend_invite` uses `inviteUserByEmail`; `delete_user` untouched (all Supabase default)
- `request-password-reset` — public, unauthenticated; rate-limited 3/10min/email; uses anon client `auth.resetPasswordForEmail`; always returns 200 to prevent enumeration
- `send-notification` — import completion/failure (still on Resend gateway with branded HTML)

**Dormant infrastructure (kept for re-activation):**
- `supabase/functions/_shared/auth-emails.ts` — exports `sendAuthEmail`, `buildInviteEmail`, `buildRecoveryEmail`, `escapeHtml`. Currently only imported by `send-notification`. Will be re-imported by the three auth functions once the domain is verified.
- `FROM_ADDRESS` constant — currently `"AchieveIt <onboarding@resend.dev>"`. Swap to `"AchieveIt <notify@achieveit.com>"` (or similar) after verification.

**Re-activation steps (once `achieveit.com` is verified in Resend):**
1. Update `FROM_ADDRESS` in `_shared/auth-emails.ts` (and `send-notification/index.ts`).
2. In `invite-user`, `admin-user-actions` (reset_password + resend_invite actions), and `request-password-reset`, swap back from Supabase built-in calls to `adminClient.auth.admin.generateLink({ type: "invite" | "recovery" })` + `sendAuthEmail({ subject, html })`. Pattern is preserved in git history.

**Frontend wiring:** `useAuth.resetPassword()` invokes `request-password-reset` edge function (so we can swap implementations server-side without client changes). AccountSettingsPage still calls `supabase.auth.resetPasswordForEmail` directly.

**Logging hygiene:** All three auth functions and `request-password-reset` `console.error` before any non-2xx return so failures appear in Supabase function logs (the original revert was opaque because errors were returned as JSON without logging).
