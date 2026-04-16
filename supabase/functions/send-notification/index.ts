import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const APP_URL = "https://achieveit-optimizer.lovable.app";
const FROM_ADDRESS = "AchieveIt <onboarding@resend.dev>";

interface NotificationPayload {
  userId?: string;
  sessionId?: string;
  status?: string;
  orgName?: string | null;
  documentName?: string | null;
  itemCount?: number | null;
}

function buildEmail(
  status: string,
  firstName: string | null,
  orgName: string,
  documentName: string,
  itemCount: number,
) {
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";
  const isSuccess = status === "completed";
  const subject = isSuccess ? "Your plan import is ready" : "Your plan import failed";

  const body = isSuccess
    ? `
        <p style="font-size:16px;color:#111;margin:0 0 16px;">${greeting}</p>
        <p style="font-size:15px;color:#333;line-height:1.5;margin:0 0 16px;">
          Your import of <strong>${escapeHtml(documentName)}</strong> for
          <strong>${escapeHtml(orgName)}</strong> has completed with
          <strong>${itemCount}</strong> item${itemCount === 1 ? "" : "s"}.
        </p>
        <p style="font-size:15px;color:#333;line-height:1.5;margin:0 0 24px;">
          Click below to review and export your plan.
        </p>
      `
    : `
        <p style="font-size:16px;color:#111;margin:0 0 16px;">${greeting}</p>
        <p style="font-size:15px;color:#333;line-height:1.5;margin:0 0 16px;">
          Unfortunately, your import of <strong>${escapeHtml(documentName)}</strong>
          for <strong>${escapeHtml(orgName)}</strong> failed to complete.
        </p>
        <p style="font-size:15px;color:#333;line-height:1.5;margin:0 0 24px;">
          Please try uploading the document again. If the problem persists, contact your administrator.
        </p>
      `;

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="background:#fff;border-radius:8px;padding:32px;border:1px solid #e5e7eb;">
      <h1 style="font-size:20px;color:#111;margin:0 0 24px;">${subject}</h1>
      ${body}
      <a href="${APP_URL}" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;font-size:14px;">
        Open AchieveIt Plan Optimizer
      </a>
    </div>
    <p style="font-size:12px;color:#6b7280;text-align:center;margin:24px 0 0;">
      You received this because email notifications are enabled for your account.
      You can disable them in Account Settings.
    </p>
  </div>
</body></html>`;

  return { subject, html };
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload = (await req.json()) as NotificationPayload;
    const { userId, sessionId, status, orgName, documentName, itemCount } = payload;

    if (!userId || !sessionId || !status) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (status !== "completed" && status !== "error") {
      return new Response(JSON.stringify({ skipped: true, reason: "non-terminal status" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: profile, error: profileErr } = await supabase
      .from("user_profiles")
      .select("email, first_name, feature_flags")
      .eq("id", userId)
      .single();

    if (profileErr || !profile?.email) {
      console.warn("[send-notification] No profile/email for user", userId, profileErr?.message);
      return new Response(JSON.stringify({ skipped: true, reason: "no email" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const flags = (profile.feature_flags ?? {}) as Record<string, unknown>;
    const optedIn = flags.email_notifications !== false; // default true
    if (!optedIn) {
      console.log("[send-notification] User opted out:", userId);
      return new Response(JSON.stringify({ skipped: true, reason: "opted out" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
      console.error("[send-notification] Missing gateway secrets");
      return new Response(JSON.stringify({ error: "Email service not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const emailStatus = status === "completed" ? "completed" : "failed";
    const { subject, html } = buildEmail(
      emailStatus === "completed" ? "completed" : "error",
      profile.first_name ?? null,
      orgName ?? "your organization",
      documentName ?? "your document",
      typeof itemCount === "number" ? itemCount : 0,
    );

    const resp = await fetch(`${GATEWAY_URL}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": RESEND_API_KEY,
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [profile.email],
        subject,
        html,
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      console.error("[send-notification] Resend error", resp.status, data);
      return new Response(JSON.stringify({ error: "Send failed", detail: data }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, id: data?.id ?? null }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[send-notification] Exception:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
