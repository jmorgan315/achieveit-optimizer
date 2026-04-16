import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { logApiCall, ensureSession, extractTokenUsage } from "../_shared/logging.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_NAME_LENGTH = 500;
const MAX_DESC_LENGTH = 2000;

function createSafeError(
  status: number,
  publicMessage: string,
  internalDetails?: unknown
): Response {
  if (internalDetails) {
    console.error('[Suggest Metrics Error]', {
      timestamp: new Date().toISOString(),
      details: internalDetails,
    });
  }
  return new Response(
    JSON.stringify({ error: publicMessage }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

function buildSystemPrompt(orgProfile?: { organizationName?: string; industry?: string; summary?: string }): string {
  let prompt = `You are an expert strategic planning consultant specializing in creating SMART metrics for AchieveIt plans.

When given a plan item name and description, suggest an appropriate metric configuration.

AchieveIt supports these metric types:
- Metric Description: "Track to Target" (progress toward goal), "Maintain" (keep at level), "Stay Above" (minimum threshold), "Stay Below" (maximum limit)
- Metric Unit: "Number", "Dollar", "Percentage"
- Metric Rollup: "Manual", "Sum Children", "Average Children"

Return your suggestion as a JSON object with these fields:
- suggestedName: A more specific, measurable version of the item name (include the target)
- metricDescription: One of the valid description types
- metricUnit: One of the valid unit types
- metricTarget: The specific numeric target value (just the number, no symbols)
- metricBaseline: The starting point value (just the number, no symbols)
- rationale: Brief explanation of why this metric is appropriate

Make metrics SMART: Specific, Measurable, Achievable, Relevant, Time-bound.`;

  if (orgProfile?.organizationName || orgProfile?.industry) {
    prompt += `\n\n=== ORGANIZATION CONTEXT ===`;
    if (orgProfile.organizationName) {
      prompt += `\nOrganization: ${orgProfile.organizationName}`;
    }
    if (orgProfile.industry) {
      prompt += `\nIndustry: ${orgProfile.industry}`;
    }
    if (orgProfile.summary) {
      prompt += `\nAbout: ${orgProfile.summary}`;
    }
    prompt += `\n\nUse this organizational context to make your metric suggestions more specific and relevant to this organization's sector, typical KPIs, and strategic priorities. Reference industry-standard benchmarks where applicable.`;
  }

  return prompt;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return createSafeError(500, 'Service configuration error. Please contact administrator.', 'ANTHROPIC_API_KEY not set');
    }

    const body = await req.json();
    const { name, description, orgProfile, sessionId: incomingSessionId } = body;
    console.log('[suggest-metrics] Received sessionId:', incomingSessionId);

    if (!name || typeof name !== 'string') {
      return createSafeError(400, 'Item name is required and must be a string.');
    }

    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      return createSafeError(400, 'Item name cannot be empty.');
    }
    if (trimmedName.length > MAX_NAME_LENGTH) {
      return createSafeError(400, `Item name must be under ${MAX_NAME_LENGTH} characters.`);
    }

    let trimmedDescription = '';
    if (description !== undefined && description !== null) {
      if (typeof description !== 'string') {
        return createSafeError(400, 'Description must be a string.');
      }
      trimmedDescription = description.trim();
      if (trimmedDescription.length > MAX_DESC_LENGTH) {
        return createSafeError(400, `Description must be under ${MAX_DESC_LENGTH} characters.`);
      }
    }

    const sessionId = await ensureSession(incomingSessionId);
    const systemPrompt = buildSystemPrompt(orgProfile);

    const userPrompt = `Plan Item: "${trimmedName}"
${trimmedDescription ? `Description: "${trimmedDescription}"` : ''}

Generate a SMART metric suggestion for this strategic plan item.`;

    const requestBody = {
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        { role: "user", content: userPrompt },
      ],
      tools: [
        {
          name: "suggest_metric",
          description: "Return a structured metric suggestion for the plan item",
          input_schema: {
            type: "object",
            properties: {
              suggestedName: { type: "string", description: "A more specific, measurable version of the item name" },
              metricDescription: { type: "string", enum: ["Track to Target", "Maintain", "Stay Above", "Stay Below"], description: "The type of metric tracking" },
              metricUnit: { type: "string", enum: ["Number", "Dollar", "Percentage"], description: "The unit of measurement" },
              metricTarget: { type: "string", description: "The target value (numeric only, no symbols)" },
              metricBaseline: { type: "string", description: "The baseline/starting value (numeric only, no symbols)" },
              rationale: { type: "string", description: "Brief explanation of why this metric is appropriate" }
            },
            required: ["suggestedName", "metricDescription", "metricUnit", "metricTarget", "metricBaseline", "rationale"],
            additionalProperties: false
          }
        }
      ],
      tool_choice: { type: "tool", name: "suggest_metric" }
    };

    const startTime = Date.now();
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
    const durationMs = Date.now() - startTime;

    if (!response.ok) {
      if (response.status === 429) {
        return createSafeError(429, 'Service temporarily busy. Please try again in a moment.');
      }
      if (response.status === 402) {
        return createSafeError(503, 'Service temporarily unavailable. Please try again later.');
      }
      const errText = await response.text();

      // Log error
      if (sessionId) {
        logApiCall({
          session_id: sessionId,
          edge_function: "suggest-metrics",
          step_label: "Metric Suggestion",
          model: "claude-sonnet-4-6",
          request_payload: requestBody as unknown as Record<string, unknown>,
          duration_ms: durationMs,
          status: "error",
          error_message: `HTTP ${response.status}: ${errText.slice(0, 500)}`,
        });
      }

      return createSafeError(500, 'Unable to generate suggestion. Please try again.', errText);
    }

    const data = await response.json();
    const toolUse = data.content?.find((block: { type: string }) => block.type === "tool_use");

    // Log the call
    if (sessionId) {
      const tokens = extractTokenUsage(data);
      logApiCall({
        session_id: sessionId,
        edge_function: "suggest-metrics",
        step_label: "Metric Suggestion",
        model: "claude-sonnet-4-6",
        request_payload: requestBody as unknown as Record<string, unknown>,
        response_payload: data,
        input_tokens: tokens.input_tokens,
        output_tokens: tokens.output_tokens,
        duration_ms: durationMs,
        status: toolUse ? "success" : "error",
        error_message: toolUse ? undefined : "No tool_use in response",
      });
    }
    
    if (!toolUse) {
      return createSafeError(500, 'Unable to generate suggestion. Please try again.', 'No tool use in response');
    }

    const suggestion = toolUse.input;

    return new Response(
      JSON.stringify({ success: true, suggestion, sessionId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return createSafeError(500, 'Unable to process request. Please try again.', error);
  }
});
