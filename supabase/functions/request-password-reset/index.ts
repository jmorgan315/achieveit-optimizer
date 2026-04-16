// Public, unauthenticated endpoint for self-service "Forgot password" flow.
// Mints a recovery link via the admin API and sends a branded email through Resend.
// Always returns 200 to avoid leaking which emails are registered.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildRecoveryEmail, sendAuthEmail } from "../_shared/auth-emails.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Very simple in-memory rate limit: max 3 requests / 10 min per email per instance.
// Edge Function instances are short-lived so this is best-effort, not durable.
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 3;
const rateMap = new Map<string, number[]>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const arr = (rateMap.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) {
    rateMap.set(key, arr);
    return true;
  }
  arr.push(now);
  rateMap.set(key, arr);
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const body = await req.json().catch(() => ({}));
    const emailRaw = (body as { email?: unknown }).email;
    if (!emailRaw || typeof emailRaw !== "string") {
      return json({ error: "Email is required" }, 400);
    }
    const email = emailRaw.trim().toLowerCase();
    if (!email.endsWith("@achieveit.com")) {
      // Mirror the frontend domain restriction
      return json({ error: "Please use your @achieveit.com email address." }, 400);
    }

    // Rate limit per email
    if (isRateLimited(email)) {
      // Still return success to avoid enumeration / abuse signaling
      console.warn("[request-password-reset] Rate limited:", email);
      return json({ success: true });
    }

    const origin = req.headers.get("origin") || req.headers.get("referer")?.replace(/\/+$/, "") || Deno.env.get("SITE_URL") || supabaseUrl.replace('.supabase.co', '.lovable.app');

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: `${origin}/reset-password` },
    });

    // If the email doesn't exist, generateLink returns an error. Don't leak that.
    if (error || !data?.properties?.action_link) {
      console.warn("[request-password-reset] No link generated:", email, error?.message);
      return json({ success: true });
    }

    const { subject, html } = buildRecoveryEmail(data.properties.action_link, email);
    const send = await sendAuthEmail({ to: email, subject, html });
    if (!send.ok) {
      console.error("[request-password-reset] Send failed:", send.error);
      // Surface a generic error so the UI can prompt a retry
      return json({ error: "We couldn't send the reset email. Please try again." }, 502);
    }

    return json({ success: true });
  } catch (err) {
    console.error("[request-password-reset] Exception:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
