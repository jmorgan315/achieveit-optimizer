

To connect Resend, you'll need to do one quick step on your end. Here's what happens and what I need from you:

## What I'll trigger
When I start implementing, I'll invoke the Resend connector. This pops up a dialog in your Lovable workspace asking you to either:
- **Pick an existing Resend connection** (if you've already linked one in another project), or
- **Create a new connection** by signing into Resend through OAuth

## What you'll need
1. **A Resend account** — free tier is fine for development (3,000 emails/month, 100/day). Sign up at https://resend.com if you don't have one.
2. **Click "Authorize"** in the OAuth popup when the connector dialog appears. That's it — no API key copy/paste, no `.env` edits. Resend's OAuth flow grants Lovable a scoped token, which the gateway uses on every send.

Once you authorize, the secrets `RESEND_API_KEY` and `LOVABLE_API_KEY` are automatically injected into the edge function environment. I never see the key, and you don't need to manage it.

## About the sender address
By default, emails will send from `AchieveIt <onboarding@resend.dev>` — Resend's shared sandbox sender that works immediately with no DNS setup. **Caveat:** Resend's sandbox sender can only deliver to the email address that owns the Resend account. So during testing, only your inbox will receive notifications.

To send to all `@achieveit.com` users (Edelmary, etc.), you'd need to **verify the achieveit.com domain in your Resend dashboard** — a one-time setup where Resend gives you DNS records (SPF, DKIM, MX) to add at your domain registrar. After verification, I can switch the sender to something like `notify@achieveit.com`.

## Decision points

| Question | Default if you don't specify |
|---|---|
| Sandbox sender (`onboarding@resend.dev`) or verify `achieveit.com` first? | Start with sandbox; switch later once domain is verified |
| Sender display name | `AchieveIt <onboarding@resend.dev>` |
| Reply-to address | None (no-reply behavior) |

## Recommended path

1. **You**: Create/log into Resend, then approve the connector dialog when I pop it up.
2. **Me**: Build the `send-notification` function, wire it into `process-plan`, add the Account Settings toggle, and run the RLS migration.
3. **You** (later, when ready for production): Verify `achieveit.com` in Resend's dashboard, then ask me to swap the sender address.

If you're ready, just say "go" and I'll start by triggering the Resend connector dialog.

