import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

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
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'LOVABLE_API_KEY is not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { name, description } = await req.json();

    if (!name) {
      return new Response(
        JSON.stringify({ error: 'Item name is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userPrompt = `Plan Item: "${name}"
${description ? `Description: "${description}"` : ''}

Generate a SMART metric suggestion for this strategic plan item.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "suggest_metric",
              description: "Return a structured metric suggestion for the plan item",
              parameters: {
                type: "object",
                properties: {
                  suggestedName: {
                    type: "string",
                    description: "A more specific, measurable version of the item name"
                  },
                  metricDescription: {
                    type: "string",
                    enum: ["Track to Target", "Maintain", "Stay Above", "Stay Below"],
                    description: "The type of metric tracking"
                  },
                  metricUnit: {
                    type: "string",
                    enum: ["Number", "Dollar", "Percentage"],
                    description: "The unit of measurement"
                  },
                  metricTarget: {
                    type: "string",
                    description: "The target value (numeric only, no symbols)"
                  },
                  metricBaseline: {
                    type: "string",
                    description: "The baseline/starting value (numeric only, no symbols)"
                  },
                  rationale: {
                    type: "string",
                    description: "Brief explanation of why this metric is appropriate"
                  }
                },
                required: ["suggestedName", "metricDescription", "metricUnit", "metricTarget", "metricBaseline", "rationale"],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "suggest_metric" } }
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'AI credits exhausted. Please add funds to continue.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const errorText = await response.text();
      console.error('AI gateway error:', response.status, errorText);
      throw new Error('AI service temporarily unavailable');
    }

    const data = await response.json();
    
    // Extract the tool call result
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      throw new Error('No suggestion generated');
    }

    const suggestion = JSON.parse(toolCall.function.arguments);

    return new Response(
      JSON.stringify({ success: true, suggestion }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Suggest metrics error:', error);
    
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to generate suggestion',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
