---
name: Auth Email Routing
description: Invites, password resets, and import notifications all go through Resend gateway with branded HTML — Supabase default emails bypassed
type: feature
---
All transactional emails (invites, admin-triggered password resets, self-service "Forgot password", and import-complete notifications) are sent via the Resend connector gateway from `onboarding@resend.dev`, NOT Supabase's built-in SMTP/email service.

**Pattern:** Edge function calls `adminClient.auth.admin.generateLink({ type: "invite" | "recovery" })` to mint the secure tokenized URL without sending mail, then ships a branded HTML email through `https://connector-gateway.lovable.dev/resend/emails`.

**Shared helper:** `supabase/functions/_shared/auth-emails.ts` exports `sendAuthEmail`, `buildInviteEmail`, `buildRecoveryEmail`, `escapeHtml`. All three flows import from it for consistent green-CTA branding.

**Functions involved:**
- `invite-user` — super_admin invites new @achieveit.com users
- `admin-user-actions` — `reset_password` and `resend_invite` actions (delete_user untouched)
- `request-password-reset` — public, unauthenticated; rate-limited 3/10min/email; always returns 200 to prevent enumeration
- `send-notification` — import completion/failure (uses same gateway pattern but its own template)

**Frontend wiring:** `useAuth.resetPassword()` invokes `request-password-reset` instead of `supabase.auth.resetPasswordForEmail()`. AccountSettingsPage still calls `resetPasswordForEmail` directly — note: this is the one remaining surface that uses Supabase default email.

**Sandbox sender caveat:** `onboarding@resend.dev` only delivers to the email that owns the Resend account until `achieveit.com` is verified in Resend's dashboard.
