---
name: Email Notifications
description: Resend-powered email sent on plan import completion or failure, opt-out via user_profiles.feature_flags.email_notifications
type: feature
---
When `process-plan` writes a terminal status (`completed` or `error`), it fires-and-forgets a call to the `send-notification` edge function. That function looks up the session's user, reads `user_profiles.feature_flags.email_notifications` (default true), and — if opted in — sends a branded email via the Resend connector gateway (`https://connector-gateway.lovable.dev/resend/emails`). Sender is `AchieveIt <onboarding@resend.dev>` (sandbox; switch to `notify@achieveit.com` once domain is verified in Resend). Users toggle the preference from Account Settings → Notifications. RLS policy `Users can update own profile` was relaxed to allow self-updates of `feature_flags` (admin/role/active stay locked).
