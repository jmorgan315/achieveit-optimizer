import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { logApiCall, ensureSession, extractTokenUsage } from "../_shared/logging.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: 'Service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { organizationName, industry, sessionId: incomingSessionId } = await req.json();

    if (!organizationName || !industry) {
      return new Response(
        JSON.stringify({ success: false, error: 'Organization name and industry are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const sessionId = await ensureSession(incomingSessionId);

    const requestBody = {
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content: `You are an expert at identifying organizations. Given an organization name and industry, identify the most likely matching organization, its official website, and provide a brief 1-2 sentence summary of what the organization does. If you're not confident, provide your best guess based on the name and industry.`
        },
        {
          role: "user",
          content: `Organization: "${organizationName}"\nIndustry: ${industry}\n\nIdentify this organization, its website, and provide a brief summary.`
        }
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "identify_organization",
            description: "Return structured information about the identified organization",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string", description: "The official name of the organization" },
                website: { type: "string", description: "The organization's official website URL" },
                summary: { type: "string", description: "A brief 1-2 sentence summary of what the organization does" }
              },
              required: ["name", "website", "summary"],
              additionalProperties: false
            }
          }
        }
      ],
      tool_choice: { type: "function", function: { name: "identify_organization" } }
    };

    const startTime = Date.now();
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
    const durationMs = Date.now() - startTime;

    if (!response.ok) {
      const errText = await response.text();

      if (sessionId) {
        logApiCall({
          session_id: sessionId,
          edge_function: "lookup-organization",
          step_label: "Organization Lookup",
          model: "google/gemini-2.5-flash",
          request_payload: requestBody as unknown as Record<string, unknown>,
          duration_ms: durationMs,
          status: "error",
          error_message: `HTTP ${response.status}: ${errText.slice(0, 500)}`,
        });
      }

      if (response.status === 429) {
        return new Response(
          JSON.stringify({ success: false, error: 'Rate limit exceeded. Please try again.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ success: false, error: 'Service temporarily unavailable.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.error('AI gateway error:', response.status, errText);
      throw new Error('AI lookup failed');
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    // Log the call
    if (sessionId) {
      const tokens = extractTokenUsage(data);
      logApiCall({
        session_id: sessionId,
        edge_function: "lookup-organization",
        step_label: "Organization Lookup",
        model: "google/gemini-2.5-flash",
        request_payload: requestBody as unknown as Record<string, unknown>,
        response_payload: data,
        input_tokens: tokens.input_tokens,
        output_tokens: tokens.output_tokens,
        duration_ms: durationMs,
        status: toolCall?.function?.arguments ? "success" : "error",
        error_message: toolCall?.function?.arguments ? undefined : "No structured response",
      });
    }
    
    if (!toolCall?.function?.arguments) {
      throw new Error('No structured response from AI');
    }

    const result = JSON.parse(toolCall.function.arguments);

    return new Response(
      JSON.stringify({ success: true, result, sessionId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Lookup error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Unable to look up organization. Please try again.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
