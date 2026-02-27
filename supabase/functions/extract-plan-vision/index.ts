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

Your task is to analyze document page images and extract ALL trackable plan items, correctly detecting the document's layout, hierarchy, and terminology.

=== STEP 1: LAYOUT DETECTION (DO THIS FIRST) ===

Before extracting content, analyze the visual layout:

1. **ORIENTATION**: Is the page Portrait (vertical) or Landscape (horizontal/wide)?
2. **CONTENT TYPE**: 
   - TABULAR/MATRIX: Has visible gridlines, column headers, row structure
   - NARRATIVE: Flowing text with headings and bullet points
   - MIXED: Combination of tables and text sections

3. **For TABULAR/LANDSCAPE documents**:
   - Count ALL columns from left edge to right edge
   - Read the FULL WIDTH of the page - do NOT truncate after column 2
   - Columns typically: 4-6 columns spanning the entire page width
   - Look for small text in the rightmost columns (KPIs, metrics)

=== STEP 2: SCHEMA DISCOVERY (DETECT HIERARCHY TERMS) ===

CRITICAL: Detect the actual terminology used in this document, NOT generic defaults.

**Where to find hierarchy terms:**
- Table column headers (e.g., "Pillar | Objective | Outcome KPI | Strategy | Strategy KPI")
- Definition sections (e.g., "Terms definitions:", "Key terms:", "Glossary")
- Section headers that repeat (e.g., "Goal 1:", "Objective 1.1:")
- Legend or key explaining the structure

**Return detected terms in documentTerminology:**
- columnHierarchy: Array of column headers in LEFT-TO-RIGHT order
- level1Term through level5Term: The actual document terms

**Example - If you see:**
"Terms definitions:
 Pillar: A broad primary goal
 Objective: A measurable step to achieve a pillar
 Strategy: An approach to achieve an objective
 KPI: A measurement of progress"

**Return:**
{
  "documentTerminology": {
    "columnHierarchy": ["Pillar", "Objective", "Outcome KPI", "Strategy", "Strategy KPI"],
    "level1Term": "Pillar",
    "level2Term": "Objective", 
    "level3Term": "Outcome KPI",
    "level4Term": "Strategy",
    "level5Term": "Strategy KPI"
  }
}

=== STEP 3: MATRIX/TABLE EXTRACTION (FOR TABULAR DOCUMENTS) ===

**Column-to-Hierarchy Mapping:**
- Column 1 (leftmost) = Level 1 = strategic_priority (deepest indent = 0)
- Column 2 = Level 2 = focus_area
- Column 3 = Level 3 = goal  
- Column 4 = Level 4 = action_item
- Column 5+ = Level 5 = sub_action

**Handling Merged Cells (CRITICAL):**
When a cell in Column 1 spans multiple rows vertically:
- This is a "merged cell" indicating ONE parent with MULTIPLE children
- The parent value applies to ALL rows until the next parent appears
- "Fill down" the parent for every child row

Example visual:
| PILLAR (merged)    | Objective    | KPI         |
| Equity & Access    | Improve...   | Increase 10%|
| (empty - merged)   | Eliminate... | Reduce 5%   |
| (empty - merged)   | Promote...   | Add 3 new   |

This means "Equity & Access" is parent to ALL three objectives.

**Full Width Capture (CRITICAL):**
- Strategic plans often have 5-6 columns
- The rightmost columns contain valuable KPI/metric data
- Do NOT stop at column 2 or 3
- Capture content all the way to the right edge of the table
- If text is small, zoom mentally on each section

=== STEP 4: NARRATIVE DOCUMENT EXTRACTION ===

For non-tabular documents, detect hierarchy from:
- Heading sizes (larger = higher level)
- Numbering patterns (1, 1.1, 1.1.1, 1.1.1.1)
- Indentation levels
- Bullet point nesting
- Bold/styled text for section headers

=== STEP 5: OUTPUT STRUCTURE ===

Return items in PROPERLY NESTED JSON format.

**CORRECT nested structure:**
{
  "name": "Equity & Access",
  "levelType": "strategic_priority",
  "children": [
    {
      "name": "Improve Access", 
      "levelType": "focus_area",
      "children": [
        {
          "name": "Increase enrollment by 10%",
          "levelType": "goal",
          "metricTarget": "10%",
          "metricUnit": "Percentage",
          "children": [
            {
              "name": "Launch outreach program",
              "levelType": "action_item",
              "children": [
                {
                  "name": "Track monthly applications",
                  "levelType": "sub_action"
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}

**WRONG (flat) structure - DO NOT DO THIS:**
[
  { "name": "Equity & Access", "levelType": "strategic_priority", "children": [] },
  { "name": "Improve Access", "levelType": "focus_area", "children": [] },
  { "name": "Increase enrollment", "levelType": "goal", "children": [] }
]

=== EXTRACTION RULES ===

✓ EXTRACT:
- All strategic priorities/pillars/themes (Level 1)
- All objectives/focus areas (Level 2)
- All goals/outcomes/KPIs with targets (Level 3)
- All strategies/initiatives/actions (Level 4)
- All strategy KPIs/metrics/measures (Level 5)
- Owner names when visible
- Target values and metrics (e.g., "10%", "500", "$2M")
- Dates and deadlines

✗ SKIP:
- Page numbers, headers, footers
- Table of contents entries
- Title pages, cover pages
- Copyright notices, disclaimers
- Decorative graphics
- Definition sections (extract terms, not definitions)

=== VALIDATION CHECKLIST ===

Before returning, verify:
1. Did I capture content from ALL columns (not just first 2)?
2. Are items properly NESTED with children arrays (not flat)?
3. Did I detect the document's actual terminology for levels?
4. For tables: Did I handle merged cells by filling down parent values?
5. Root level items should be 3-8 strategic priorities, not 20+ flat items`;

const extractPlanItemsSchema = {
  type: "object",
  properties: {
    layoutInfo: {
      type: "object",
      description: "Detected layout characteristics of the document",
      properties: {
        orientation: { type: "string", enum: ["portrait", "landscape"], description: "Page orientation" },
        contentType: { type: "string", enum: ["tabular", "narrative", "mixed"], description: "Primary content format" },
        columnCount: { type: "number", description: "Number of data columns detected in tables (0 if narrative)" },
        hasMergedCells: { type: "boolean", description: "Whether table has vertically merged cells" }
      }
    },
    documentTerminology: {
      type: "object",
      description: "Actual hierarchy terminology found in this specific document",
      properties: {
        columnHierarchy: { 
          type: "array", 
          items: { type: "string" },
          description: "Table column headers in LEFT-TO-RIGHT order representing hierarchy (e.g., ['Pillar', 'Objective', 'Outcome KPI', 'Strategy', 'Strategy KPI'])"
        },
        level1Term: { type: "string", description: "Document's actual term for Level 1 (e.g., 'Pillar', 'Theme', 'Strategic Priority')" },
        level2Term: { type: "string", description: "Document's actual term for Level 2 (e.g., 'Objective', 'Focus Area')" },
        level3Term: { type: "string", description: "Document's actual term for Level 3 (e.g., 'Outcome KPI', 'Goal')" },
        level4Term: { type: "string", description: "Document's actual term for Level 4 (e.g., 'Strategy', 'Initiative')" },
        level5Term: { type: "string", description: "Document's actual term for Level 5 (e.g., 'Strategy KPI', 'Metric', 'Tollgate')" }
      }
    },
    items: {
      type: "array",
      description: "Hierarchically nested list of extracted plan items",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Concise name for the plan item (max 100 chars)" },
          levelType: { type: "string", enum: ["strategic_priority", "focus_area", "goal", "action_item", "sub_action"], description: "The hierarchy level type" },
          description: { type: "string", description: "Brief description adding context (optional)" },
          owner: { type: "string", description: "Person, role, or department responsible (if visible)" },
          metricTarget: { type: "string", description: "Target value for KPIs (e.g., '10%', '500', '$2M')" },
          metricUnit: { type: "string", enum: ["Number", "Dollar", "Percentage", "None"], description: "Unit type for metrics" },
          startDate: { type: "string", description: "Start date in YYYY-MM-DD format (if visible)" },
          dueDate: { type: "string", description: "Due/target date in YYYY-MM-DD format (if visible)" },
          children: { 
            type: "array", 
            description: "Nested child items - MUST be objects, not strings",
            items: { $ref: "#/properties/items/items" } 
          }
        },
        required: ["name", "levelType"]
      }
    },
    detectedLevels: {
      type: "array",
      description: "The hierarchy levels detected in this document with actual document terminology",
      items: {
        type: "object",
        properties: {
          depth: { type: "number", description: "Hierarchy depth (1 = top level)" },
          name: { type: "string", description: "Actual term used in document (e.g., 'Pillar', not 'Level 1')" }
        },
        required: ["depth", "name"]
      }
    }
  },
  required: ["items", "detectedLevels", "documentTerminology"]
};

// Clean and normalize the AI response
function normalizeResponse(data: Record<string, unknown>): Record<string, unknown> {
  // Clean up documentTerminology
  if (data.documentTerminology) {
    const terms = data.documentTerminology as Record<string, unknown>;
    
    // Clean columnHierarchy - remove numeric prefixes like "6130Pillar"
    if (Array.isArray(terms.columnHierarchy)) {
      terms.columnHierarchy = terms.columnHierarchy.map((term: string) => {
        if (typeof term === 'string') {
          // Remove leading numbers
          return term.replace(/^\d+/, '').trim();
        }
        return term;
      }).filter((term: string) => term && term.length > 0);
    }
    
    // Clean level terms
    ['level1Term', 'level2Term', 'level3Term', 'level4Term', 'level5Term'].forEach(key => {
      if (typeof terms[key] === 'string') {
        terms[key] = (terms[key] as string).replace(/^\d+/, '').trim();
      }
    });
  }
  
  // Rebuild detectedLevels from documentTerminology if available
  const terms = data.documentTerminology as Record<string, unknown> | undefined;
  if (terms?.columnHierarchy && Array.isArray(terms.columnHierarchy) && terms.columnHierarchy.length > 0) {
    data.detectedLevels = (terms.columnHierarchy as string[]).map((name: string, idx: number) => ({
      depth: idx + 1,
      name: name
    }));
  } else if (terms) {
    // Build from level terms
    const levels: Array<{depth: number, name: string}> = [];
    if (terms.level1Term) levels.push({ depth: 1, name: terms.level1Term as string });
    if (terms.level2Term) levels.push({ depth: 2, name: terms.level2Term as string });
    if (terms.level3Term) levels.push({ depth: 3, name: terms.level3Term as string });
    if (terms.level4Term) levels.push({ depth: 4, name: terms.level4Term as string });
    if (terms.level5Term) levels.push({ depth: 5, name: terms.level5Term as string });
    
    if (levels.length > 0) {
      data.detectedLevels = levels;
    }
  }
  
  // Normalize items - ensure children are objects, not strings
  if (Array.isArray(data.items)) {
    data.items = normalizeItems(data.items as unknown[]);
  }
  
  return data;
}

// Recursively normalize items
function normalizeItems(items: unknown[]): unknown[] {
  return items.map(item => {
    if (!item || typeof item !== 'object') return null;
    
    const itemObj = item as Record<string, unknown>;
    
    // If children is an array of strings, convert to objects
    if (Array.isArray(itemObj.children)) {
      itemObj.children = itemObj.children
        .map((child: unknown) => {
          if (typeof child === 'string') {
            // Convert string to object - try to guess levelType
            const parentType = itemObj.levelType as string;
            let childType = 'action_item';
            if (parentType === 'strategic_priority') childType = 'focus_area';
            else if (parentType === 'focus_area') childType = 'goal';
            else if (parentType === 'goal') childType = 'action_item';
            else if (parentType === 'action_item') childType = 'sub_action';
            
            return { name: child, levelType: childType, children: [] };
          }
          return child;
        })
        .filter((child: unknown) => child !== null && child !== undefined);
      
      // Recursively normalize children
      itemObj.children = normalizeItems(itemObj.children as unknown[]);
    }
    
    return itemObj;
  }).filter(item => item !== null);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return createSafeError(500, 'Service configuration error. Please contact administrator.', 'ANTHROPIC_API_KEY not set');
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
        text: `CONTEXT FROM PREVIOUS PAGES:\n${previousContext}\n\nContinue extracting from the following pages, maintaining consistency with the structure and terminology detected above. Use the SAME level terms.`
      });
    }

    content.push({
      type: "text",
      text: `Analyze these ${pageImages.length} document page(s). 

IMPORTANT INSTRUCTIONS:
1. First, detect the layout (portrait/landscape, tabular/narrative)
2. Find the document's ACTUAL hierarchy terminology (look for definitions, column headers)
3. For TABLES: Capture content from ALL columns, including the rightmost KPI columns
4. Handle merged cells by "filling down" the parent value
5. Return NESTED items with children arrays, not a flat list

Extract all strategic plan items with their proper hierarchy.`
    });

    // Add each page image
    pageImages.forEach((base64Image: string) => {
      content.push({
        type: "image_url",
        image_url: {
          url: base64Image.startsWith('data:') ? base64Image : `data:image/png;base64,${base64Image}`
        }
      });
    });

    // Convert content array to Anthropic format
    const anthropicContent: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> = [];
    
    for (const item of content) {
      if (item.type === "text" && item.text) {
        anthropicContent.push({ type: "text", text: item.text });
      } else if (item.type === "image_url" && item.image_url) {
        // Extract base64 data and media type from data URL
        const url = item.image_url.url;
        const match = url.match(/^data:(image\/[^;]+);base64,(.+)$/);
        if (match) {
          anthropicContent.push({
            type: "image",
            source: {
              type: "base64",
              media_type: match[1],
              data: match[2]
            }
          });
        }
      }
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 16384,
        system: VISION_EXTRACTION_PROMPT,
        messages: [
          { role: "user", content: anthropicContent }
        ],
        tools: [{
          name: "extract_plan_items",
          description: "Extract structured plan items from document page images with layout detection and schema discovery",
          input_schema: extractPlanItemsSchema
        }],
        tool_choice: { type: "tool", name: "extract_plan_items" }
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
    const toolUse = aiResponse.content?.find((block: { type: string }) => block.type === "tool_use");
    
    if (!toolUse || toolUse.name !== "extract_plan_items") {
      return createSafeError(500, 'Unable to extract plan items from images. Please try again.', 'Unexpected AI response format');
    }

    let extractedData = toolUse.input as Record<string, unknown>;
    
    // Normalize and clean the response
    extractedData = normalizeResponse(extractedData);
    
    console.log(`Vision AI extracted ${extractedData.items?.length || 0} top-level items`);
    if (extractedData.layoutInfo) {
      console.log(`Layout: ${extractedData.layoutInfo.orientation}, ${extractedData.layoutInfo.contentType}, ${extractedData.layoutInfo.columnCount || 0} columns`);
    }
    if (extractedData.documentTerminology?.columnHierarchy) {
      console.log(`Detected hierarchy: ${extractedData.documentTerminology.columnHierarchy.join(' → ')}`);
    }

    // Build context summary for next batch
    let contextSummary = "";
    if (extractedData.items?.length > 0) {
      const topLevelNames = extractedData.items.slice(0, 5).map((item: { name: string }) => item.name);
      contextSummary = `Previously found Level 1 items: ${topLevelNames.join(", ")}`;
      
      if (extractedData.documentTerminology) {
        const terms = extractedData.documentTerminology;
        const hierarchy = terms.columnHierarchy?.join(' → ') || 
          [terms.level1Term, terms.level2Term, terms.level3Term, terms.level4Term, terms.level5Term]
            .filter(Boolean).join(' → ');
        contextSummary += `\nDocument hierarchy: ${hierarchy}`;
      }
      
      if (extractedData.layoutInfo) {
        contextSummary += `\nLayout: ${extractedData.layoutInfo.orientation} ${extractedData.layoutInfo.contentType}`;
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
