import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EXTRACTION_SYSTEM_PROMPT = `You are an expert at analyzing strategic planning documents and extracting ONLY actionable, trackable items with PROPER HIERARCHICAL NESTING.

Your task is to identify plan items that an organization would track progress on over time. 

EXTRACT these types of items (IN HIERARCHICAL ORDER):
1. strategic_priority - Top-level themes (e.g., "Economic Security", "Climate Resilience") - ONLY these at root
2. focus_area - Mid-level groupings under priorities (e.g., "Housing Access", "Workforce Development")
3. goal - Specific trackable outcomes with targets (e.g., "Increase affordable units by 3%")
4. action_item - Concrete work items (e.g., "Complete permit applications by Q2")

SKIP these (do NOT include as plan items):
- Table of contents, page numbers, headers, footers
- Mission statements, vision statements, organizational values
- Demographic data, population statistics, historical context
- Introductory paragraphs, background narrative
- Image captions, chart titles, infographic descriptions
- Achievements from previous years (unless they set baselines)
- General descriptions without actionable outcomes

=== CRITICAL HIERARCHY RULES (MUST FOLLOW) ===

1. ROOT LEVEL: ONLY strategic_priority items. If you find yourself putting focus_area, goal, or action_item at root, STOP and restructure.

2. EVERY ITEM MUST USE children[] FOR NESTING:
   - strategic_priority -> children: [focus_area items]
   - focus_area -> children: [goal items]
   - goal -> children: [action_item items]

3. VALIDATION BEFORE RETURNING:
   - Count root items: Should be 3-7 strategic priorities MAXIMUM
   - If you have >8 root items, your nesting is WRONG
   - Each strategic_priority SHOULD have focus_area children
   - Goals should be nested under focus_areas, not at root

=== BULLET POINT HANDLING (CRITICAL) ===

When you see bullet points under a heading:
- ALL bullets at the same indent level = SAME levelType
- Bullets under "Housing Access" heading = children of that focus_area
- Example: "The county will:" followed by 5 bullets = 5 goals nested under that section

DO NOT:
- Put bullets as siblings at root level
- Skip bullet points
- Mix bullet types (if 5 bullets, all should be same levelType)

=== CORRECT NESTING EXAMPLE ===

INPUT:
"Economic Security and Social Stability
  Housing Access and Affordability
    • Increase affordable units by 3%
    • Support inclusionary housing
    • Invest in mobile home parks"

OUTPUT:
{
  "name": "Economic Security and Social Stability",
  "levelType": "strategic_priority",
  "children": [
    {
      "name": "Housing Access and Affordability",
      "levelType": "focus_area",
      "children": [
        { "name": "Increase affordable units by 3%", "levelType": "goal" },
        { "name": "Support inclusionary housing", "levelType": "goal" },
        { "name": "Invest in mobile home parks", "levelType": "goal" }
      ]
    }
  ]
}

=== WRONG (FLAT) OUTPUT - DO NOT DO THIS ===
[
  { "name": "Economic Security", "levelType": "strategic_priority" },
  { "name": "Housing Access", "levelType": "focus_area" },
  { "name": "Increase affordable units", "levelType": "goal" }
]
// WRONG: Everything is at root level with no children arrays!

=== SELF-CHECK BEFORE RESPONDING ===
1. Are there more than 7 items at root? → Restructure into nested hierarchy
2. Do root items have empty children arrays? → Move subsequent items into children
3. Are focus_area items at root? → They should be children of strategic_priority
4. Are goal items at root? → They should be children of focus_area or strategic_priority`;

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
            enum: ["Number", "Dollar", "Percentage", "None"],
            description: "Unit type for the metric (use 'None' if not applicable)"
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
