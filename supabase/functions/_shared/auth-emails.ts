// Shared Resend sender + branded HTML templates for auth emails (invite + recovery).
// Uses the Lovable connector gateway so credentials stay server-side.

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const FROM_ADDRESS = "AchieveIt <onboarding@resend.dev>";

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface SendAuthEmailArgs {
  to: string;
  subject: string;
  html: string;
}

export interface SendAuthEmailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export async function sendAuthEmail({ to, subject, html }: SendAuthEmailArgs): Promise<SendAuthEmailResult> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
    return { ok: false, error: "Email gateway not configured (missing LOVABLE_API_KEY or RESEND_API_KEY)" };
  }

  try {
    const resp = await fetch(`${GATEWAY_URL}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": RESEND_API_KEY,
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [to],
        subject,
        html,
      }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const detail = typeof data === "object" ? JSON.stringify(data) : String(data);
      return { ok: false, error: `Resend ${resp.status}: ${detail}` };
    }
    return { ok: true, id: (data as { id?: string })?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown send error" };
  }
}

function wrapShell(subject: string, innerHtml: string, footer: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="background:#fff;border-radius:8px;padding:32px;border:1px solid #e5e7eb;">
      <h1 style="font-size:20px;color:#111;margin:0 0 24px;">${escapeHtml(subject)}</h1>
      ${innerHtml}
    </div>
    <p style="font-size:12px;color:#6b7280;text-align:center;margin:24px 0 0;">
      ${footer}
    </p>
  </div>
</body></html>`;
}

function ctaButton(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;font-size:14px;">${escapeHtml(label)}</a>`;
}

export function buildInviteEmail(actionLink: string, recipientEmail: string): { subject: string; html: string } {
  const subject = "You've been invited to AchieveIt Plan Optimizer";
  const inner = `
    <p style="font-size:16px;color:#111;margin:0 0 16px;">Hi,</p>
    <p style="font-size:15px;color:#333;line-height:1.5;margin:0 0 16px;">
      You've been invited to join the <strong>AchieveIt Plan Optimizer</strong>.
      Click the button below to accept the invitation and set up your password.
    </p>
    <p style="margin:0 0 24px;">${ctaButton(actionLink, "Accept invitation")}</p>
    <p style="font-size:13px;color:#6b7280;line-height:1.5;margin:0 0 8px;">
      If the button doesn't work, paste this link into your browser:
    </p>
    <p style="font-size:12px;color:#6b7280;word-break:break-all;margin:0;">
      ${escapeHtml(actionLink)}
    </p>
  `;
  const footer = `This invitation was sent to ${escapeHtml(recipientEmail)}. If you weren't expecting it, you can ignore this email.`;
  return { subject, html: wrapShell(subject, inner, footer) };
}

export function buildRecoveryEmail(actionLink: string, recipientEmail: string): { subject: string; html: string } {
  const subject = "Reset your AchieveIt password";
  const inner = `
    <p style="font-size:16px;color:#111;margin:0 0 16px;">Hi,</p>
    <p style="font-size:15px;color:#333;line-height:1.5;margin:0 0 16px;">
      We received a request to reset the password for your AchieveIt account.
      Click the button below to choose a new password.
    </p>
    <p style="margin:0 0 24px;">${ctaButton(actionLink, "Reset password")}</p>
    <p style="font-size:13px;color:#6b7280;line-height:1.5;margin:0 0 8px;">
      If the button doesn't work, paste this link into your browser:
    </p>
    <p style="font-size:12px;color:#6b7280;word-break:break-all;margin:0 0 16px;">
      ${escapeHtml(actionLink)}
    </p>
    <p style="font-size:13px;color:#6b7280;line-height:1.5;margin:0;">
      This link expires in about 1 hour. If you didn't request a password reset, you can safely ignore this email.
    </p>
  `;
  const footer = `This password reset was requested for ${escapeHtml(recipientEmail)}.`;
  return { subject, html: wrapShell(subject, inner, footer) };
}
