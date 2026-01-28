import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Validation constants
const MAX_IMAGES = 20;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB per image base64

// Safe error helper
function createSafeError(
  status: number,
  publicMessage: string,
  internalDetails?: unknown
): Response {
  if (internalDetails) {
    console.error('[Vision Extraction Error]', {
      timestamp: new Date().toISOString(),
      details: internalDetails,
    });
  }
  return new Response(
    JSON.stringify({ success: false, error: publicMessage }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

const VISION_EXTRACTION_PROMPT = `You are an expert document analyst specializing in extracting strategic plan content from visual documents.

You are looking at page images from a strategic planning document. Your task is to extract ALL trackable plan items regardless of the document's visual format (tables, infographics, lists, matrices, etc.).

=== DOCUMENT TERMINOLOGY DETECTION ===

Many documents define their own hierarchy terms. DETECT and MAP these to our standard levels:

Common document terms → Standard mapping:
- "Pillar", "Strategic Priority", "Theme" → strategic_priority (depth 1)
- "Objective", "Focus Area", "Goal Area" → focus_area (depth 2)  
- "Strategy", "Initiative", "Tactic", "Goal" → goal (depth 3)
- "KPI", "Metric", "Measure", "Action", "Tollgate" → action_item (depth 4)

Look for definition sections that explain the document's terminology and use those definitions.

=== TABULAR/MATRIX EXTRACTION ===

When content is in tables or matrices:
1. Identify column headers (e.g., "Pillar | Objective | Outcome KPIs | Strategies | Strategy KPIs")
2. Each row represents related items across hierarchy levels
3. Items in the same row share a parent-child relationship
4. Extract ALL items from ALL columns - don't skip KPIs or metrics

Example table structure:
| Pillar | Objective | Strategies | KPIs |
| Equity | Improve Access | Expand services | Increase by 10% |

This should produce:
- strategic_priority: "Equity"
  - focus_area: "Improve Access"
    - goal: "Expand services"
      - action_item: "Increase by 10%" (with metricTarget: "10%")

=== HIERARCHY FROM VISUAL LAYOUT ===

Detect hierarchy from:
- Column position (left = higher level, right = lower level)
- Visual indentation or nesting
- Font size (larger = higher level)
- Numbering schemes (1, 1.1, 1.1.1)
- Color coding or grouping
- Headers and sub-headers

=== WHAT TO EXTRACT ===

✓ Strategic priorities/pillars/themes
✓ Objectives and focus areas
✓ Goals, strategies, initiatives
✓ KPIs, metrics, targets (with values)
✓ Action items and tasks
✓ Owner names if visible
✓ Dates and deadlines if visible

=== WHAT TO SKIP ===

✗ Page numbers, headers, footers
✗ Table of contents
✗ Title pages and cover pages
✗ Copyright notices
✗ Decorative elements
✗ Image captions unless they contain plan items

=== CRITICAL NESTING RULES ===

1. ROOT LEVEL: Only strategic_priority items should be at root
2. USE children[] ARRAY: All sub-items must be nested in their parent's children array
3. VALIDATE: If you have >8 root items, restructure - items are likely flat when they should be nested

=== OUTPUT FORMAT ===

Return properly nested items with:
- name: The item text (concise, <100 chars)
- levelType: strategic_priority | focus_area | goal | action_item
- description: Additional context if available
- owner: Person/department name if visible
- metricTarget: Numeric target if this is a KPI (e.g., "10%", "500", "$2M")
- metricUnit: Number | Dollar | Percentage | None
- children: Array of nested child items`;

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
          levelType: { type: "string", enum: ["strategic_priority", "focus_area", "goal", "action_item"], description: "The hierarchy level of this item" },
          description: { type: "string", description: "Brief description adding actionable context (optional)" },
          owner: { type: "string", description: "Person, role, or department responsible (if mentioned)" },
          metricTarget: { type: "string", description: "Target value if this is a measurable goal (e.g., '3%', '600', '$2M')" },
          metricUnit: { type: "string", enum: ["Number", "Dollar", "Percentage", "None"], description: "Unit type for the metric" },
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
    },
    documentTerminology: {
      type: "object",
      description: "Custom terminology found in the document",
      properties: {
        level1Term: { type: "string", description: "Document's term for top level (e.g., 'Pillar')" },
        level2Term: { type: "string", description: "Document's term for second level (e.g., 'Objective')" },
        level3Term: { type: "string", description: "Document's term for third level (e.g., 'Strategy')" },
        level4Term: { type: "string", description: "Document's term for fourth level (e.g., 'KPI')" }
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
    const { pageImages, previousContext } = body;

    // Validate pageImages
    if (!pageImages || !Array.isArray(pageImages) || pageImages.length === 0) {
      return createSafeError(400, "Page images are required as a non-empty array.");
    }

    if (pageImages.length > MAX_IMAGES) {
      return createSafeError(413, `Too many images. Maximum ${MAX_IMAGES} pages allowed per request.`);
    }

    // Validate each image
    for (let i = 0; i < pageImages.length; i++) {
      const img = pageImages[i];
      if (typeof img !== "string") {
        return createSafeError(400, `Invalid image data at index ${i}. Expected base64 string.`);
      }
      if (img.length > MAX_IMAGE_SIZE) {
        return createSafeError(413, `Image at index ${i} is too large. Maximum 5MB per image.`);
      }
    }

    console.log(`Processing ${pageImages.length} page images with vision AI`);

    // Build content array with images
    const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];

    // Add context from previous pages if available
    if (previousContext) {
      content.push({
        type: "text",
        text: `CONTEXT FROM PREVIOUS PAGES:\n${previousContext}\n\nContinue extracting from the following pages, maintaining consistency with the above context.`
      });
    }

    content.push({
      type: "text",
      text: `Analyze these ${pageImages.length} document page(s) and extract all strategic plan items. Look carefully at tables, matrices, and visual layouts.`
    });

    // Add each page image
    pageImages.forEach((base64Image: string, index: number) => {
      content.push({
        type: "image_url",
        image_url: {
          url: base64Image.startsWith('data:') ? base64Image : `data:image/png;base64,${base64Image}`
        }
      });
    });

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: VISION_EXTRACTION_PROMPT },
          { role: "user", content }
        ],
        tools: [{
          type: "function",
          function: {
            name: "extract_plan_items",
            description: "Extract structured plan items from document page images",
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
      return createSafeError(500, 'Vision processing failed. Please try again.', await response.text());
    }

    const aiResponse = await response.json();
    const toolCall = aiResponse.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall || toolCall.function?.name !== "extract_plan_items") {
      return createSafeError(500, 'Unable to extract plan items from images. Please try again.', 'Unexpected AI response format');
    }

    const extractedData = JSON.parse(toolCall.function.arguments);
    console.log(`Vision AI extracted ${extractedData.items?.length || 0} top-level items`);

    // Build context summary for next batch if needed
    let contextSummary = "";
    if (extractedData.items?.length > 0) {
      const topLevelNames = extractedData.items.slice(0, 5).map((item: { name: string }) => item.name);
      contextSummary = `Previously found items: ${topLevelNames.join(", ")}`;
      if (extractedData.documentTerminology) {
        const terms = extractedData.documentTerminology;
        contextSummary += `\nDocument terminology: ${terms.level1Term || 'Priority'} > ${terms.level2Term || 'Objective'} > ${terms.level3Term || 'Strategy'} > ${terms.level4Term || 'KPI'}`;
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        data: extractedData,
        contextSummary
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return createSafeError(500, 'Unable to process document images. Please try again.', error);
  }
});
