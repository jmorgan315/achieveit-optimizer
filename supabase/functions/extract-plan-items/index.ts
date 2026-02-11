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

=== DYNAMIC LEVEL DETECTION (CRITICAL) ===

Every document has its own hierarchy. Your job is to DETECT the levels the document uses, not force it into a template.

1. Read the document and identify its natural hierarchy levels.
2. Assign a consistent, descriptive levelType string to each level (e.g., "strategic_priority", "focus_area", "goal", "action_item", "kpi", or whatever terms fit the document).
3. Items at the same hierarchy depth MUST use the same levelType string.
4. Report all detected levels in the detectedLevels array, with depth 1 for the highest level, depth 2 for the next, etc.

Examples of level detection:
- A 3-level document might have: strategic_priority (depth 1), focus_area (depth 2), goal (depth 3)
- A 5-level document might have: pillar (depth 1), objective (depth 2), outcome_kpi (depth 3), strategy (depth 4), strategy_kpi (depth 5)
- A 2-level document might have: theme (depth 1), initiative (depth 2)

Look for definition sections like "Terms definitions:", "Key terms:", "Glossary" that explain the document's terminology.

EXTRACT these types of items (trackable, actionable items at any level):
- Top-level themes/priorities/pillars
- Mid-level groupings/objectives/focus areas
- Goals with targets
- Strategies, initiatives, actions
- KPIs, metrics, measures

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

=== CRITICAL HIERARCHY RULES (MUST FOLLOW) ===

1. DETECT THE DOCUMENT'S NATURAL STRUCTURE:
   - Read the document and identify the hierarchy it actually presents
   - The number of root items depends entirely on the document — it could be 3, 15, or 50
   - Do NOT force the document into a predetermined template or framework
   - Follow the document's own groupings, headings, sections, and nesting

2. ROOT LEVEL: ONLY the highest-level items at root. EVERY lower-level item MUST be nested as a child — NEVER at root level.

3. EVERY ITEM MUST USE children[] FOR NESTING:
   - Level 1 items -> children: [Level 2 items]
   - Level 2 items -> children: [Level 3 items]
   - Level 3 items -> children: [Level 4 items]
   - And so on for however many levels the document has

4. NESTING IS MANDATORY:
   - EVERY bullet point, numbered item, goal, and action MUST be nested as a child under its parent — NEVER at root level
   - If the document has headings with bullets/items underneath, the heading is the parent and the bullets are children
   - If you find yourself putting everything at root level with no children, you are doing it WRONG — go back and nest items under their natural parents

5. VALIDATION BEFORE RETURNING:
   - Each root item SHOULD have children
   - Lower-level items should be nested under their parents, not at root
   - If all items are at root with empty children arrays, your response is WRONG — go back and nest them properly
   - Did you preserve the document's own hierarchy? Do parent items have their children nested?

=== BULLET POINT HANDLING (CRITICAL) ===

When you see bullet points under a heading:
- ALL bullets at the same indent level = SAME levelType
- Bullets under a section heading = children of that section
- Example: "The county will:" followed by 5 bullets = 5 children nested under that section

DO NOT:
- Put bullets as siblings at root level
- Skip bullet points
- Mix bullet types (if 5 bullets, all should be same levelType)

=== CORRECT NESTING EXAMPLE ===

INPUT:
"Section A: Quality Improvement
  Area 1: Patient Safety
    • Reduce readmission rates by 5%
    • Implement safety protocols
    • Train staff on new procedures"

OUTPUT:
{
  "items": [
    {
      "name": "Quality Improvement",
      "levelType": "priority",
      "children": [
        {
          "name": "Patient Safety",
          "levelType": "focus_area",
          "children": [
            { "name": "Reduce readmission rates by 5%", "levelType": "goal" },
            { "name": "Implement safety protocols", "levelType": "goal" },
            { "name": "Train staff on new procedures", "levelType": "goal" }
          ]
        }
      ]
    }
  ],
  "detectedLevels": [
    { "depth": 1, "name": "priority" },
    { "depth": 2, "name": "focus_area" },
    { "depth": 3, "name": "goal" }
  ]
}

=== WRONG (FLAT) OUTPUT - DO NOT DO THIS ===
[
  { "name": "Quality Improvement", "levelType": "priority" },
  { "name": "Patient Safety", "levelType": "focus_area" },
  { "name": "Reduce readmission rates", "levelType": "goal" }
]
// WRONG: Everything is at root level with no children arrays!

=== SELF-CHECK BEFORE RESPONDING ===
1. Did you detect and follow the document's own structure?
2. Did you report all detected levels in detectedLevels with correct depth ordering?
3. Do root items have empty children arrays? → Move subsequent items into children
4. Are lower-level items at root? → They should be children of higher-level items
5. If all items are at root with no nesting, your response is WRONG — restructure.`;

// Helper to build a single item schema at a given nesting depth
function buildItemProperties(): Record<string, unknown> {
  return {
    name: { type: "string", description: "Concise name for the plan item (max 100 chars)" },
    levelType: { type: "string", description: "A label for this item's hierarchy level. Items at the same hierarchy depth should use the same levelType string. Use descriptive snake_case labels like 'strategic_priority', 'focus_area', 'goal', etc." },
    description: { type: "string", description: "Brief description adding actionable context (optional)" },
    owner: { type: "string", description: "Person, role, or department responsible (if mentioned)" },
    metricTarget: { type: "string", description: "Target value if this is a measurable goal (e.g., '3%', '600', '$2M')" },
    metricUnit: { type: "string", enum: ["Number", "Dollar", "Percentage", "None"], description: "Unit type for the metric (use 'None' if not applicable)" },
    startDate: { type: "string", description: "Start date in YYYY-MM-DD format (if mentioned)" },
    dueDate: { type: "string", description: "Due/target date in YYYY-MM-DD format (if mentioned)" },
  };
}

// Build inlined schema with explicit nesting (no $ref)
const level4Item = {
  type: "object",
  properties: {
    ...buildItemProperties(),
    // Deepest level — no children
  },
  required: ["name", "levelType"],
};

const level3Item = {
  type: "object",
  properties: {
    ...buildItemProperties(),
    children: { type: "array", description: "Nested child items", items: level4Item },
  },
  required: ["name", "levelType"],
};

const level2Item = {
  type: "object",
  properties: {
    ...buildItemProperties(),
    children: { type: "array", description: "Nested child items", items: level3Item },
  },
  required: ["name", "levelType"],
};

const level1Item = {
  type: "object",
  properties: {
    ...buildItemProperties(),
    children: { type: "array", description: "Nested child items", items: level2Item },
  },
  required: ["name", "levelType"],
};

const extractPlanItemsSchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      description: "Hierarchical list of extracted plan items (root-level items only, with children nested)",
      items: level1Item
    },
    detectedLevels: {
      type: "array",
      description: "The hierarchy levels detected in this document, ordered by depth",
      items: {
        type: "object",
        properties: {
          depth: { type: "number", description: "Depth in hierarchy (1 = highest/root level)" },
          name: { type: "string", description: "The levelType label used for items at this depth" }
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
    console.log(`Extracted ${extractedData.items?.length || 0} top-level items, detected ${extractedData.detectedLevels?.length || 0} levels`);

    return new Response(
      JSON.stringify({ success: true, data: extractedData }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return createSafeError(500, 'Unable to process document. Please try again.', error);
  }
});
