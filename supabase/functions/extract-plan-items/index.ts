import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EXTRACTION_SYSTEM_PROMPT = `You are an expert at analyzing strategic planning documents and extracting ONLY actionable, trackable items.

Your task is to identify plan items that an organization would track progress on over time. 

EXTRACT these types of items:
- Strategic Priorities / Pillars (top-level themes like "Economic Security", "Climate Resilience")
- Focus Areas / Objectives (mid-level groupings under priorities)
- Goals / Initiatives / KPIs (specific trackable outcomes with targets)
- Action Items / Tasks (concrete work items)

SKIP these (do NOT include as plan items):
- Table of contents, page numbers, headers, footers
- Mission statements, vision statements, organizational values
- Demographic data, population statistics, historical context
- Introductory paragraphs, background narrative
- Image captions, chart titles, infographic descriptions
- Achievements from previous years (unless they set baselines)
- General descriptions without actionable outcomes
- Repeated content or summaries

For each item you extract:
1. Identify its level in the hierarchy (strategic_priority > focus_area > goal > action_item)
2. Extract any metrics, targets, or KPIs mentioned
3. Extract any owners, departments, or responsible parties mentioned
4. Extract any dates or timeframes mentioned
5. Keep the name concise but descriptive
6. Include relevant description if it adds actionable context

IMPORTANT: Be selective. A 30-page strategic plan should yield 15-40 trackable items, not 100+.
If something reads like narrative context rather than a trackable goal, skip it.

CRITICAL HIERARCHY RULES:
1. The root level should ONLY contain Strategic Priorities (top-level themes). Typically 3-7 items.
2. Focus Areas MUST be nested as children of Strategic Priorities.
3. Goals MUST be nested as children of Focus Areas or Strategic Priorities.
4. Action Items MUST be nested as children of Goals or Focus Areas.
5. NEVER return goals or action items at the root level - they must be nested under a parent.

BULLET POINT HANDLING:
- If you see a list of bullets following a section header (e.g., "The county will:"), ALL bullets become children of that section.
- Bullets prefixed with "•", "-", "*", "→", or similar should ALL be captured as the same level type.
- If bullets appear at the same indent level, treat them ALL as the same item type (e.g., all as goals or all as action_items).
- Do NOT skip bullet points - capture every actionable bullet under a heading.
- Example: "For its part, the county will:" followed by 5 bullets = 5 goals/action_items under that focus area.

NESTING EXAMPLES:
Good structure:
{
  "name": "Economic Security",
  "levelType": "strategic_priority",
  "children": [
    {
      "name": "Housing Access",
      "levelType": "focus_area", 
      "children": [
        { "name": "Increase affordable units by 3%", "levelType": "goal" },
        { "name": "Support inclusionary housing initiatives", "levelType": "goal" },
        { "name": "Invest in mobile home parks", "levelType": "goal" }
      ]
    }
  ]
}

Bad structure (DO NOT DO THIS):
[
  { "name": "Economic Security", "levelType": "strategic_priority" },
  { "name": "Housing Access", "levelType": "focus_area" },
  { "name": "Increase affordable units by 3%", "levelType": "goal" }
]
// BAD: Items are flat instead of nested!`;

const extractPlanItemsSchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      description: "Hierarchical list of extracted plan items",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Concise name for the plan item (max 100 chars)"
          },
          levelType: {
            type: "string",
            enum: ["strategic_priority", "focus_area", "goal", "action_item"],
            description: "The hierarchy level of this item"
          },
          description: {
            type: "string",
            description: "Brief description adding actionable context (optional)"
          },
          owner: {
            type: "string",
            description: "Person, role, or department responsible (if mentioned)"
          },
          metricTarget: {
            type: "string",
            description: "Target value if this is a measurable goal (e.g., '3%', '600', '$2M')"
          },
          metricUnit: {
            type: "string",
            enum: ["Number", "Dollar", "Percentage", ""],
            description: "Unit type for the metric"
          },
          startDate: {
            type: "string",
            description: "Start date in YYYY-MM-DD format (if mentioned)"
          },
          dueDate: {
            type: "string",
            description: "Due/target date in YYYY-MM-DD format (if mentioned)"
          },
          children: {
            type: "array",
            description: "Nested child items under this item",
            items: {
              $ref: "#/properties/items/items"
            }
          }
        },
        required: ["name", "levelType"]
      }
    },
    detectedLevels: {
      type: "array",
      description: "The hierarchy level names detected in this document",
      items: {
        type: "object",
        properties: {
          depth: { type: "number" },
          name: { type: "string" }
        },
        required: ["depth", "name"]
      }
    }
  },
  required: ["items", "detectedLevels"]
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentText } = await req.json();

    if (!documentText || typeof documentText !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: "Missing or invalid documentText" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY is not configured");
      return new Response(
        JSON.stringify({ success: false, error: "AI service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing document with ${documentText.length} characters`);

    // Truncate very long documents to avoid token limits
    const maxChars = 100000;
    const truncatedText = documentText.length > maxChars 
      ? documentText.slice(0, maxChars) + "\n\n[Document truncated for processing]"
      : documentText;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
          { role: "user", content: `Please analyze this strategic planning document and extract only the trackable plan items:\n\n${truncatedText}` }
        ],
        tools: [{
          type: "function",
          function: {
            name: "extract_plan_items",
            description: "Extract structured plan items from a strategic planning document",
            parameters: extractPlanItemsSchema
          }
        }],
        tool_choice: { type: "function", function: { name: "extract_plan_items" } }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ success: false, error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ success: false, error: "AI credits exhausted. Please add credits to continue." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ success: false, error: "AI processing failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiResponse = await response.json();
    
    // Extract the tool call result
    const toolCall = aiResponse.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function?.name !== "extract_plan_items") {
      console.error("Unexpected AI response format:", JSON.stringify(aiResponse));
      return new Response(
        JSON.stringify({ success: false, error: "AI returned unexpected response format" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const extractedData = JSON.parse(toolCall.function.arguments);
    
    console.log(`Extracted ${extractedData.items?.length || 0} top-level items`);

    return new Response(
      JSON.stringify({
        success: true,
        data: extractedData
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Extract plan items error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
