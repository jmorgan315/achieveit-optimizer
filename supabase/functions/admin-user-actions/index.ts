import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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
      console.error("[admin-user-actions] Unauthorized: no caller");
      return json({ error: "Unauthorized" }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: profile } = await adminClient
      .from("user_profiles")
      .select("role")
      .eq("id", caller.id)
      .single();

    if (profile?.role !== 'super_admin') {
      console.error("[admin-user-actions] Forbidden: caller is not super_admin", caller.id);
      return json({ error: "Super admin access required" }, 403);
    }

    const { action, userId, email } = await req.json();
    const origin = req.headers.get("origin") || req.headers.get("referer")?.replace(/\/+$/, "") || Deno.env.get("SITE_URL") || supabaseUrl.replace('.supabase.co', '.lovable.app');

    if (action === "reset_password") {
      if (!email || typeof email !== "string") {
        console.error("[admin-user-actions:reset_password] Missing email");
        return json({ error: "Email is required" }, 400);
      }

      // Use Supabase's built-in recovery email (anon client triggers default email send).
      // Resend is intentionally not used here until the achieveit.com domain is verified.
      const anonAuthClient = createClient(supabaseUrl, anonKey);
      const { error } = await anonAuthClient.auth.resetPasswordForEmail(email, {
        redirectTo: `${origin}/reset-password`,
      });
      if (error) {
        console.error("[admin-user-actions:reset_password] resetPasswordForEmail failed:", error.message);
        return json({ error: error.message }, 400);
      }

      return json({ success: true });
    }

    if (action === "resend_invite") {
      if (!email || typeof email !== "string") {
        console.error("[admin-user-actions:resend_invite] Missing email");
        return json({ error: "Email is required" }, 400);
      }

      // Use Supabase's built-in invite (sends default invitation email).
      const { error } = await adminClient.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${origin}/reset-password`,
      });
      if (error) {
        console.error("[admin-user-actions:resend_invite] inviteUserByEmail failed:", error.message);
        return json({ error: error.message }, 400);
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

    if (action === "generate_invite_link") {
      if (!email || typeof email !== "string") {
        console.error("[admin-user-actions:generate_invite_link] Missing email");
        return json({ error: "Email is required" }, 400);
      }

      // Try to generate an invite link for a user that doesn't exist yet.
      // If they already exist, fall back to a magic/recovery link so admin can still share access.
      let actionLink: string | null = null;

      const inviteRes = await adminClient.auth.admin.generateLink({
        type: "invite",
        email,
        options: { redirectTo: `${origin}/reset-password` },
      });

      if (inviteRes.error) {
        // Common: "User already registered" → fall back to recovery link
        const msg = inviteRes.error.message || "";
        const alreadyExists = /already|registered|exists/i.test(msg);
        if (!alreadyExists) {
          console.error("[admin-user-actions:generate_invite_link] generateLink(invite) failed:", msg);
          return json({ error: msg }, 400);
        }
        const recoveryRes = await adminClient.auth.admin.generateLink({
          type: "recovery",
          email,
          options: { redirectTo: `${origin}/reset-password` },
        });
        if (recoveryRes.error) {
          console.error("[admin-user-actions:generate_invite_link] generateLink(recovery) failed:", recoveryRes.error.message);
          return json({ error: recoveryRes.error.message }, 400);
        }
        actionLink = recoveryRes.data?.properties?.action_link ?? null;
      } else {
        actionLink = inviteRes.data?.properties?.action_link ?? null;
        // Mark invited_at since this counts as an invite
        if (userId) {
          await adminClient
            .from("user_profiles")
            .update({ invited_at: new Date().toISOString() })
            .eq("id", userId);
        }
      }

      if (!actionLink) {
        console.error("[admin-user-actions:generate_invite_link] No action_link returned");
        return json({ error: "Failed to generate invite link" }, 500);
      }

      await adminClient.from("user_activity_log").insert({
        user_id: caller.id,
        activity_type: "invite_link_generated",
        metadata: { target_email: email, target_user_id: userId ?? null },
      });

      return json({ success: true, action_link: actionLink });
    }

    if (action === "delete_user") {
      if (!userId || typeof userId !== "string") {
        console.error("[admin-user-actions:delete_user] Missing userId");
        return json({ error: "userId is required" }, 400);
      }
      const { error } = await adminClient.auth.admin.deleteUser(userId);
      if (error) {
        console.error("[admin-user-actions:delete_user] deleteUser failed:", error.message);
        return json({ error: error.message }, 400);
      }
      return json({ success: true });
    }

    console.error("[admin-user-actions] Unknown action:", action);
    return json({ error: "Unknown action. Use 'reset_password', 'resend_invite', or 'delete_user'." }, 400);
  } catch (err) {
    console.error("[admin-user-actions] Exception:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
