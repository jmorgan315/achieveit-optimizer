import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildInviteEmail, buildRecoveryEmail, sendAuthEmail } from "../_shared/auth-emails.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller is super_admin
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) {
      return json({ error: "Unauthorized" }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: profile } = await adminClient
      .from("user_profiles")
      .select("role")
      .eq("id", caller.id)
      .single();

    if (profile?.role !== 'super_admin') {
      return json({ error: "Super admin access required" }, 403);
    }

    const { action, userId, email } = await req.json();
    const origin = req.headers.get("origin") || req.headers.get("referer")?.replace(/\/+$/, "") || Deno.env.get("SITE_URL") || supabaseUrl.replace('.supabase.co', '.lovable.app');

    if (action === "reset_password") {
      if (!email || typeof email !== "string") {
        return json({ error: "Email is required" }, 400);
      }

      const { data, error } = await adminClient.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo: `${origin}/reset-password` },
      });
      if (error || !data?.properties?.action_link) {
        return json({ error: error?.message ?? "Failed to generate recovery link" }, 400);
      }

      const { subject, html } = buildRecoveryEmail(data.properties.action_link, email);
      const send = await sendAuthEmail({ to: email, subject, html });
      if (!send.ok) {
        return json({ error: `Email send failed: ${send.error}` }, 502);
      }

      return json({ success: true });
    }

    if (action === "resend_invite") {
      if (!email || typeof email !== "string") {
        return json({ error: "Email is required" }, 400);
      }

      const { data, error } = await adminClient.auth.admin.generateLink({
        type: "invite",
        email,
        options: { redirectTo: `${origin}/reset-password` },
      });
      if (error || !data?.properties?.action_link) {
        return json({ error: error?.message ?? "Failed to generate invite link" }, 400);
      }

      const { subject, html } = buildInviteEmail(data.properties.action_link, email);
      const send = await sendAuthEmail({ to: email, subject, html });
      if (!send.ok) {
        return json({ error: `Email send failed: ${send.error}` }, 502);
      }

      // Update invited_at
      if (userId) {
        await adminClient
          .from("user_profiles")
          .update({ invited_at: new Date().toISOString() })
          .eq("id", userId);
      }

      // Log to user_activity_log
      await adminClient.from("user_activity_log").insert({
        user_id: caller.id,
        activity_type: "invite_resent",
        metadata: { target_email: email, target_user_id: userId },
      });

      return json({ success: true });
    }

    if (action === "delete_user") {
      if (!userId || typeof userId !== "string") {
        return json({ error: "userId is required" }, 400);
      }
      const { error } = await adminClient.auth.admin.deleteUser(userId);
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    return json({ error: "Unknown action. Use 'reset_password', 'resend_invite', or 'delete_user'." }, 400);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
