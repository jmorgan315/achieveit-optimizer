

## Diagnosis
- First invite to `marketing@achieveit.com` at 18:45:13 → **succeeded** (status 200, hook ran). User probably needs to check spam.
- Resend invite at 18:46:41 → **429 over_email_send_rate_limit**. Supabase's shared default SMTP throttles at ~2-4/hour.
- Our revert to Supabase built-in solved Resend's sandbox-recipient problem but introduced this new throttling problem.

## Recommendation: Move to Lovable's managed email infrastructure

Lovable Cloud has a built-in branded email system that uses a verified subdomain (e.g. `notify.achieveit.com`) under Lovable's nameservers. This eliminates BOTH problems we've been juggling:
- No Resend sandbox recipient restriction (delivers to any address)
- No Supabase shared-SMTP rate limit (uses our own dedicated sender)
- Branded `from:` address out of the box
- Custom HTML templates with auto-applied AchieveIt styling

It also removes the dormant Resend complexity entirely for auth emails.

## Plan

### 1. Set up email domain (one-time, requires DNS)
Open the email domain setup dialog. Steps inside the dialog:
- Pick subdomain (default `notify` → sender becomes `notify@achieveit.com`)
- Add the 2 NS records shown at the achieveit.com DNS provider
- Wait for verification (DNS propagation, usually <1hr)

DNS verification doesn't block scaffolding — we can build the templates and deploy immediately.

### 2. Scaffold AchieveIt-branded auth email templates
Generates 6 React Email templates (signup, recovery, invite, magic-link, email-change, reauthentication) plus the `auth-email-hook` edge function that intercepts ALL Supabase auth emails. Auto-styled with:
- AchieveIt green primary button
- Poppins font
- AchieveIt logo (from `public/`) at top of each email
- Copy adapted to AchieveIt voice ("Welcome to AchieveIt Plan Optimizer", etc.)

### 3. Deploy the hook
Once `auth-email-hook` is deployed, ALL Supabase-issued auth emails (invites, password resets, forgot-password) automatically route through it — no changes needed to `invite-user`, `admin-user-actions`, or `request-password-reset`. They keep calling `inviteUserByEmail` / `resetPasswordForEmail`, but Supabase routes the actual delivery through our branded templates instead of the default shared sender.

### 4. Cleanup (after DNS verifies)
- Remove dormant `_shared/auth-emails.ts` (Resend-based) — no longer needed for auth
- Decide what to do with `send-notification` (still on Resend gateway)
   - Option A: Migrate it too → use Lovable's `scaffold_transactional_email` (consistent infrastructure, same verified domain)
   - Option B: Leave on Resend for now (works fine for the single recipient case)
- Disconnect Resend connector if no longer used

### 5. What stays the same
- `useAuth.resetPassword()` still calls `request-password-reset` edge function
- `request-password-reset` still uses anon-client `resetPasswordForEmail` with rate-limit + enumeration protection — but emails now ship via the branded hook
- All existing UI flows (Users admin page, Forgot password link) unchanged

## Immediate workaround (while we set this up)
Tell user to:
1. Check spam folder for original 18:45:13 invite — it likely arrived
2. Wait ~1 hour before retrying resend (rate limit resets)

## Files affected
| File | Change |
|------|--------|
| New: `supabase/functions/auth-email-hook/index.ts` | Webhook handler routing all auth emails through queue |
| New: `supabase/functions/_shared/email-templates/*.tsx` | 6 React Email templates, AchieveIt branded |
| New: `email_send_log`, `email_send_state`, `suppressed_emails`, `email_unsubscribe_tokens` tables, `auth_emails` + `transactional_emails` pgmq queues, pg_cron job | Created automatically by infra setup |
| `_shared/auth-emails.ts` | Delete (after migration confirmed working) |
| `invite-user/index.ts`, `admin-user-actions/index.ts`, `request-password-reset/index.ts` | No changes needed — they keep calling Supabase native methods, hook intercepts |
| `.lovable/memory/features/auth-email-routing.md` | Update to reflect managed email infra |

## What I need from you
Confirm: **proceed with email domain setup?** You'll need DNS access to achieveit.com to add 2 NS records.

If yes, I'll open the email setup dialog as the first step, then scaffold + deploy the templates. After you complete the dialog and DNS verifies, invites and password resets become branded and unthrottled automatically.

