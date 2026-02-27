import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Validation constants
const MAX_NAME_LENGTH = 500;
const MAX_DESC_LENGTH = 2000;

// Safe error helper
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

const systemPrompt = `You are an expert strategic planning consultant specializing in creating SMART metrics for AchieveIt plans.

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
    const { name, description } = body;

    // Validate name
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

    // Validate description if provided
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

    const userPrompt = `Plan Item: "${trimmedName}"
${trimmedDescription ? `Description: "${trimmedDescription}"` : ''}

Generate a SMART metric suggestion for this strategic plan item.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
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
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return createSafeError(429, 'Service temporarily busy. Please try again in a moment.');
      }
      if (response.status === 402) {
        return createSafeError(503, 'Service temporarily unavailable. Please try again later.');
      }
      return createSafeError(500, 'Unable to generate suggestion. Please try again.', await response.text());
    }

    const data = await response.json();
    const toolUse = data.content?.find((block: { type: string }) => block.type === "tool_use");
    
    if (!toolUse) {
      return createSafeError(500, 'Unable to generate suggestion. Please try again.', 'No tool use in response');
    }

    const suggestion = toolUse.input;

    return new Response(
      JSON.stringify({ success: true, suggestion }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return createSafeError(500, 'Unable to process request. Please try again.', error);
  }
});
