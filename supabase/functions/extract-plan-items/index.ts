import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Validation constants
const MAX_TEXT_LENGTH = 300000;
const MIN_TEXT_LENGTH = 50;

// Safe error helper
function createSafeError(
  status: number,
  publicMessage: string,
  internalDetails?: unknown
): Response {
  if (internalDetails) {
    console.error('[Extract Plan Items Error]', {
      timestamp: new Date().toISOString(),
      details: internalDetails,
    });
  }
  return new Response(
    JSON.stringify({ success: false, error: publicMessage }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

const EXTRACTION_SYSTEM_PROMPT = `You are an expert at analyzing strategic planning documents and extracting ONLY actionable, trackable items with PROPER HIERARCHICAL NESTING.

Your task is to identify plan items that an organization would track progress on over time. 

=== DOCUMENT TERMINOLOGY DETECTION (CRITICAL) ===

Many documents define their own hierarchy terms. DETECT and MAP these to our standard levels:

Common document terms → Standard mapping:
- "Pillar", "Strategic Priority", "Theme", "Strategic Goal" → strategic_priority (depth 1)
- "Objective", "Focus Area", "Goal Area", "Priority Area" → focus_area (depth 2)  
- "Outcome KPI", "Goal", "Target", "Key Result" → goal (depth 3)
- "Strategy", "Initiative", "Tactic", "Program", "Action" → action_item (depth 4)
- "Strategy KPI", "Metric", "Measure", "Tollgate", "Sub-metric" → sub_action (depth 5)

Look for definition sections like "Terms definitions:", "Key terms:", "Glossary" that explain the document's terminology.

EXTRACT these types of items (IN HIERARCHICAL ORDER):
1. strategic_priority - Top-level themes (e.g., "Economic Security", "Climate Resilience", "Equity & Access")
2. focus_area - Mid-level groupings under priorities (e.g., "Housing Access", "Workforce Development")
3. goal - Outcome KPIs with targets (e.g., "Increase affordable units by 3%")
4. action_item - Strategies and initiatives (e.g., "Expand services", "Complete permit applications by Q2")
5. sub_action - Strategy KPIs, metrics, tollgates (e.g., "Track monthly", "Increase by 10%")

SKIP these (do NOT include as plan items):
- Table of contents, page numbers, headers, footers
- Mission statements, vision statements, organizational values
- Demographic data, population statistics, historical context
- Introductory paragraphs, background narrative
- Image captions, chart titles, infographic descriptions
- Achievements from previous years (unless they set baselines)
- General descriptions without actionable outcomes

=== TABULAR/MATRIX STRUCTURE HANDLING ===

If the document text appears to come from a table or matrix format:
1. Look for patterns like repeated column-style data
2. Items on the same "row" share parent-child relationships
3. KPIs/Metrics belong under their associated Strategy/Goal
4. Extract ALL items including those that look like metrics or KPIs

Example: If you see "Pillar: Equity | Objective: Access | Strategy: Expand | KPI: +10%"
This should produce:
- strategic_priority: "Equity"
  - focus_area: "Access"
    - goal: "Expand"
      - action_item: "+10%" (with metricTarget)

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
          name: { type: "string", description: "Concise name for the plan item (max 100 chars)" },
          levelType: { type: "string", enum: ["strategic_priority", "focus_area", "goal", "action_item", "sub_action"], description: "The hierarchy level of this item" },
          description: { type: "string", description: "Brief description adding actionable context (optional)" },
          owner: { type: "string", description: "Person, role, or department responsible (if mentioned)" },
          metricTarget: { type: "string", description: "Target value if this is a measurable goal (e.g., '3%', '600', '$2M')" },
          metricUnit: { type: "string", enum: ["Number", "Dollar", "Percentage", "None"], description: "Unit type for the metric (use 'None' if not applicable)" },
          startDate: { type: "string", description: "Start date in YYYY-MM-DD format (if mentioned)" },
          dueDate: { type: "string", description: "Due/target date in YYYY-MM-DD format (if mentioned)" },
          children: { type: "array", description: "Nested child items under this item", items: { $ref: "#/properties/items/items" } }
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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return createSafeError(500, 'Service configuration error. Please contact administrator.', 'LOVABLE_API_KEY not set');
    }

    const body = await req.json();
    const { documentText } = body;

    // Validate documentText exists and is a string
    if (!documentText || typeof documentText !== "string") {
      return createSafeError(400, "Document text is required and must be a string.");
    }

    const trimmedText = documentText.trim();

    // Validate minimum length
    if (trimmedText.length < MIN_TEXT_LENGTH) {
      return createSafeError(400, `Document text too short. Minimum ${MIN_TEXT_LENGTH} characters required.`);
    }

    // Reject if too long (instead of silent truncation)
    if (trimmedText.length > MAX_TEXT_LENGTH) {
      return createSafeError(413, `Document text too long. Maximum ${MAX_TEXT_LENGTH} characters allowed.`);
    }

    console.log(`Processing document with ${trimmedText.length} characters`);

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
          { role: "user", content: `Please analyze this strategic planning document and extract only the trackable plan items:\n\n${trimmedText}` }
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
      if (response.status === 429) {
        return createSafeError(429, 'Service temporarily busy. Please try again in a moment.');
      }
      if (response.status === 402) {
        return createSafeError(503, 'Service temporarily unavailable. Please try again later.');
      }
      return createSafeError(500, 'Document processing failed. Please try again.', await response.text());
    }

    const aiResponse = await response.json();
    const toolCall = aiResponse.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall || toolCall.function?.name !== "extract_plan_items") {
      return createSafeError(500, 'Unable to extract plan items. Please try again.', 'Unexpected AI response format');
    }

    const extractedData = JSON.parse(toolCall.function.arguments);
    console.log(`Extracted ${extractedData.items?.length || 0} top-level items`);

    return new Response(
      JSON.stringify({ success: true, data: extractedData }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return createSafeError(500, 'Unable to process document. Please try again.', error);
  }
});
