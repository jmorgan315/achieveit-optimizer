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

    // Verify caller is admin
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsError } = await callerClient.auth.getClaims(
      authHeader.replace("Bearer ", "")
    );
    if (claimsError || !claimsData?.claims) {
      return json({ error: "Unauthorized" }, 401);
    }
    const callerId = claimsData.claims.sub as string;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: profile } = await adminClient
      .from("user_profiles")
      .select("is_admin")
      .eq("id", callerId)
      .single();

    if (!profile?.is_admin) {
      return json({ error: "Admin access required" }, 403);
    }

    const { action, userId, email } = await req.json();

    if (action === "reset_password") {
      if (!email || typeof email !== "string") {
        return json({ error: "Email is required" }, 400);
      }
      const { error } = await adminClient.auth.admin.generateLink({
        type: "recovery",
        email,
      });
      if (error) return json({ error: error.message }, 400);
      // Also send the reset email
      await adminClient.auth.resetPasswordForEmail(email, {
        redirectTo: `${req.headers.get("origin") || ""}/reset-password`,
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

    return json({ error: "Unknown action. Use 'reset_password' or 'delete_user'." }, 400);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
