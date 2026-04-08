import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { logApiCall, ensureSession, extractTokenUsage } from "../_shared/logging.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Validation constants
const MAX_TEXT_LENGTH = 300000;
const MIN_TEXT_LENGTH = 50;
const CHUNK_SIZE = 25000;

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

function countBulletMarkers(text: string): number {
  const patterns = [
    /^[\s]*[-•●◦▪▸►]\s/gm,
    /^[\s]*\d+[\.\)]\s/gm,
    /^[\s]*[a-zA-Z][\.\)]\s/gm,
    /^[\s]*[ivxIVX]+[\.\)]\s/gm,
  ];
  let count = 0;
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) count += matches.length;
  }
  return count;
}

function countAllItems(items: unknown[]): number {
  let count = 0;
  for (const item of items) {
    count++;
    const i = item as { children?: unknown[] };
    if (i.children?.length) count += countAllItems(i.children);
  }
  return count;
}

function collectItemNames(items: unknown[]): string[] {
  const names: string[] = [];
  for (const item of items) {
    const i = item as { name?: string; children?: unknown[] };
    if (i.name) names.push(i.name);
    if (i.children?.length) names.push(...collectItemNames(i.children));
  }
  return names;
}

function splitDocumentIntoChunks(text: string, maxChunkSize: number): string[] {
  if (text.length <= maxChunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChunkSize) {
      chunks.push(remaining);
      break;
    }

    let splitAt = maxChunkSize;
    const lastDoubleNewline = remaining.lastIndexOf('\n\n', maxChunkSize);
    if (lastDoubleNewline > maxChunkSize * 0.5) {
      splitAt = lastDoubleNewline + 2;
    } else {
      const lastNewline = remaining.lastIndexOf('\n', maxChunkSize);
      if (lastNewline > maxChunkSize * 0.5) {
        splitAt = lastNewline + 1;
      }
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  return chunks;
}

const EXTRACTION_SYSTEM_PROMPT = `You are an expert at analyzing strategic planning documents and extracting ONLY actionable, trackable items with PROPER HIERARCHICAL NESTING.

=== VERBATIM TEXT EXTRACTION (CRITICAL) ===

For the 'name' field of each item, use the EXACT text from the document. Do not rephrase, summarize, shorten, or 'clean up' the text. Copy it character-for-character. If an item says 'Increase year-over-year revenue growth by 15% through strategic market expansion', that entire string is the name — do not shorten it to 'Increase revenue growth'. The only acceptable modification is removing leading bullet characters or numbering (e.g., "1." or "•").

=== COMPLETENESS IS CRITICAL ===

You MUST extract EVERY SINGLE bullet point, numbered item, goal, strategy, action, KPI, and metric in the document. Do NOT summarize, skip, or combine items you consider minor or redundant. If the document has 15 bullets under a heading, your output MUST have 15 children under that parent. Count the bullets in each section and ensure your output has AT LEAST that many children.

FAILURE TO EXTRACT ALL ITEMS IS THE WORST POSSIBLE ERROR. When in doubt, INCLUDE the item.

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

=== BULLET POINT HANDLING (CRITICAL) ===

When you see bullet points under a heading:
- ALL bullets at the same indent level = SAME levelType
- Bullets under a section heading = children of that section
- Example: "The county will:" followed by 5 bullets = 5 children nested under that section
- If you see 10 bullets, you MUST output 10 children. NOT 5, NOT 7. ALL 10.

DO NOT:
- Put bullets as siblings at root level
- Skip bullet points
- Mix bullet types (if 5 bullets, all should be same levelType)
- Summarize multiple bullets into fewer items

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
5. If all items are at root with no nesting, your response is WRONG — restructure.
6. COUNT: Does the number of items in your output match the number of items in the document? If not, go back and add the missing ones.`;

const VERIFICATION_SYSTEM_PROMPT = `You are a completeness auditor. You will receive:
1. The original document text
2. A list of items that were already extracted

Your ONLY job is to find items that were MISSED. Look for:
- Bullet points not in the extracted list
- Numbered items not in the extracted list
- Goals, strategies, actions, KPIs mentioned in the text but missing from extraction
- Sub-items under headings that were skipped

Return ONLY the missing items, properly nested under their correct parent (use the parent's name to indicate where they belong). If nothing was missed, return an empty items array.

Be thorough — check every bullet, every numbered item, every heading with sub-items.`;

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

const level7Item = {
  type: "object",
  properties: { ...buildItemProperties() },
  required: ["name", "levelType"],
};

const level6Item = {
  type: "object",
  properties: { ...buildItemProperties(), children: { type: "array", description: "Nested child items", items: level7Item } },
  required: ["name", "levelType"],
};

const level5Item = {
  type: "object",
  properties: { ...buildItemProperties(), children: { type: "array", description: "Nested child items", items: level6Item } },
  required: ["name", "levelType"],
};

const level4Item = {
  type: "object",
  properties: { ...buildItemProperties(), children: { type: "array", description: "Nested child items", items: level5Item } },
  required: ["name", "levelType"],
};

const level3Item = {
  type: "object",
  properties: { ...buildItemProperties(), children: { type: "array", description: "Nested child items", items: level4Item } },
  required: ["name", "levelType"],
};

const level2Item = {
  type: "object",
  properties: { ...buildItemProperties(), children: { type: "array", description: "Nested child items", items: level3Item } },
  required: ["name", "levelType"],
};

const level1Item = {
  type: "object",
  properties: { ...buildItemProperties(), children: { type: "array", description: "Nested child items", items: level2Item } },
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

const verificationSchema = {
  type: "object",
  properties: {
    missingItems: {
      type: "array",
      description: "Items that were missed in the initial extraction",
      items: {
        type: "object",
        properties: {
          parentName: { type: "string", description: "Name of the parent item this belongs under (must match an existing extracted item name). Use empty string if it's a new root item." },
          name: { type: "string", description: "Name of the missed item" },
          levelType: { type: "string", description: "Level type matching the document's hierarchy" },
          description: { type: "string", description: "Brief description (optional)" },
          metricTarget: { type: "string", description: "Target value if measurable" },
          metricUnit: { type: "string", enum: ["Number", "Dollar", "Percentage", "None"] },
        },
        required: ["parentName", "name", "levelType"]
      }
    }
  },
  required: ["missingItems"]
};

interface ExtractedChunkResult {
  items: unknown[];
  detectedLevels: { depth: number; name: string }[];
}

async function callAnthropicWithRetry(
  body: Record<string, unknown>,
  apiKey: string,
  maxRetries = 2
): Promise<unknown> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.status === 429 && attempt < maxRetries) {
      const waitTime = Math.pow(2, attempt + 1) * 2000;
      console.log(`Rate limited, waiting ${waitTime}ms before retry ${attempt + 1}...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      continue;
    }

    if (!response.ok) {
      if (response.status === 429) {
        throw { status: 429, message: 'Service temporarily busy. Please try again in a moment.' };
      }
      if (response.status === 402) {
        throw { status: 402, message: 'Service temporarily unavailable. Please try again later.' };
      }
      const errorText = await response.text();
      throw { status: 500, message: 'Document processing failed. Please try again.', details: errorText };
    }

    return await response.json();
  }
  throw { status: 429, message: 'Service temporarily busy. Please try again in a moment.' };
}

async function processChunk(
  chunkText: string,
  chunkIndex: number,
  totalChunks: number,
  previousContext: { detectedLevels: { depth: number; name: string }[]; extractedItemNames: string[] } | null,
  apiKey: string,
  orgContext?: { organizationName?: string; industry?: string; documentHints?: string; planLevels?: Array<{ depth: number; name: string }>; pageRange?: string | { startPage: number; endPage: number } },
  sessionId?: string,
  batchLabel?: string
): Promise<ExtractedChunkResult> {
  const bulletCount = countBulletMarkers(chunkText);
  console.log(`Chunk ${chunkIndex + 1}: detected ~${bulletCount} bullet markers in text`);

  let orgContextPrefix = '';
  if (orgContext && chunkIndex === 0) {
    const parts: string[] = [];
    if (orgContext.organizationName) parts.push(`Organization: ${orgContext.organizationName}`);
    if (orgContext.industry) parts.push(`Industry: ${orgContext.industry}`);
    if (orgContext.documentHints) parts.push(`User-provided document hints: ${orgContext.documentHints}\n(Use these hints to guide your focus — e.g., if a page range is mentioned, prioritize that section but don't ignore surrounding context that may be relevant.)`);
    if (orgContext.pageRange) {
      parts.push(`IMPORTANT: The user has indicated that the actionable plan content is on pages ${orgContext.pageRange.startPage} through ${orgContext.pageRange.endPage} of the original document. Focus your extraction ONLY on content from those pages. Ignore introductory material, appendices, and context that falls outside this range.`);
    }
    if (orgContext.planLevels && orgContext.planLevels.length > 0) {
      const levelsList = orgContext.planLevels.map((l, idx) => {
        const suffix = idx === 0 ? ' (highest)' : idx === orgContext.planLevels!.length - 1 ? ' (lowest)' : '';
        return `Level ${l.depth}${suffix}: ${l.name}`;
      }).join('\n');
      parts.push(`\nPLAN HIERARCHY SCHEMA (provided by user — treat as authoritative):\nThe user has defined the following hierarchy levels for their plan. Use these EXACT level names and this EXACT ordering. Do NOT invent additional levels or rename these levels.\n${levelsList}\n\nEvery extracted item MUST be assigned to one of these levels. If you encounter items that don't clearly fit, assign them to the closest appropriate level.`);
    }
    if (parts.length > 0) orgContextPrefix = `ORGANIZATION CONTEXT:\n${parts.join('\n')}\n\n`;
  }

  let userMessage = `${orgContextPrefix}Please analyze this strategic planning document and extract EVERY trackable plan item. There are approximately ${bulletCount} bullet/list markers in this text — make sure you capture all of them.\n\n${chunkText}`;

  if (previousContext && chunkIndex > 0) {
    const levelsList = previousContext.detectedLevels.map(l => `${l.name} (depth ${l.depth})`).join(', ');
    const itemsList = previousContext.extractedItemNames.join(', ');
    userMessage = `Continue extracting plan items from this document section (chunk ${chunkIndex + 1} of ${totalChunks}).

IMPORTANT CONTEXT:
- Previously detected hierarchy levels: ${levelsList}. Use these SAME level names for consistency.
- Previously extracted top-level items: ${itemsList}
- Do NOT re-extract any items already listed above.
- Extract only NEW items found in this section.
- There are approximately ${bulletCount} bullet/list markers in this section — make sure you capture all of them.

Document section:\n\n${chunkText}`;
  }

  const requestBody = {
    model: "claude-opus-4-6",
    max_tokens: 16384,
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    tools: [{
      name: "extract_plan_items",
      description: "Extract structured plan items from a strategic planning document",
      input_schema: extractPlanItemsSchema
    }],
    tool_choice: { type: "tool", name: "extract_plan_items" }
  };

  const startTime = Date.now();
  const aiResponse = await callAnthropicWithRetry(requestBody, apiKey);
  const durationMs = Date.now() - startTime;

  const response = aiResponse as { content?: { type: string; name?: string; input?: unknown }[]; usage?: Record<string, number> };
  const toolUse = response.content?.find((block) => block.type === "tool_use");

  // Log the extraction call
  if (sessionId) {
    const tokens = extractTokenUsage(aiResponse as Record<string, unknown>);
    logApiCall({
      session_id: sessionId,
      edge_function: "extract-plan-items",
      step_label: batchLabel ? `${batchLabel}` : `Chunk ${chunkIndex + 1}/${totalChunks} Extraction`,
      model: "claude-opus-4-6",
      request_payload: requestBody as unknown as Record<string, unknown>,
      response_payload: aiResponse as Record<string, unknown>,
      input_tokens: tokens.input_tokens,
      output_tokens: tokens.output_tokens,
      duration_ms: durationMs,
      status: toolUse ? "success" : "error",
      error_message: toolUse ? undefined : "No tool_use in response",
    });
  }

  if (!toolUse || toolUse.name !== "extract_plan_items") {
    throw { status: 500, message: 'Unable to extract plan items. Please try again.', details: 'Unexpected AI response format' };
  }

  const result = toolUse.input as ExtractedChunkResult;
  const extractedTotal = countAllItems(result.items || []);
  console.log(`Chunk ${chunkIndex + 1}: extracted ${extractedTotal} total items (${result.items?.length || 0} top-level), bullet markers: ${bulletCount}`);

  const shouldVerify = bulletCount > 0 && extractedTotal < bulletCount * 0.6;
  if (shouldVerify) {
    console.log(`Chunk ${chunkIndex + 1}: Gap detected (${extractedTotal} extracted vs ${bulletCount} markers). Running verification pass...`);
  }

  try {
    const verifiedItems = await runVerificationPass(chunkText, result.items, apiKey, chunkIndex, totalChunks, sessionId);
    if (verifiedItems.length > 0) {
      console.log(`Verification found ${verifiedItems.length} missing items, merging...`);
      mergeVerifiedItems(result.items, verifiedItems);
      const newTotal = countAllItems(result.items);
      console.log(`After merge: ${newTotal} total items`);
    } else {
      console.log(`Verification pass: no missing items found`);
    }
  } catch (verifyError) {
    console.error('Verification pass failed (non-fatal):', verifyError);
  }

  return result;
}

interface MissingItem {
  parentName: string;
  name: string;
  levelType: string;
  description?: string;
  metricTarget?: string;
  metricUnit?: string;
}

async function runVerificationPass(
  chunkText: string,
  extractedItems: unknown[],
  apiKey: string,
  chunkIndex: number,
  totalChunks: number,
  sessionId?: string
): Promise<MissingItem[]> {
  const extractedNames = collectItemNames(extractedItems);
  
  const userMessage = `Here is a document section and the items that were already extracted from it. Find any bullets, goals, strategies, actions, or KPIs that were MISSED.

ALREADY EXTRACTED (${extractedNames.length} items):
${extractedNames.map(n => `- ${n}`).join('\n')}

DOCUMENT TEXT:
${chunkText}

Look carefully at every bullet point, numbered item, and sub-item. If any are not in the extracted list above, return them as missing items with the correct parent name.`;

  const requestBody = {
    model: "claude-opus-4-6",
    max_tokens: 8192,
    system: VERIFICATION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    tools: [{
      name: "report_missing_items",
      description: "Report items that were missed in the initial extraction",
      input_schema: verificationSchema
    }],
    tool_choice: { type: "tool", name: "report_missing_items" }
  };

  const startTime = Date.now();
  const aiResponse = await callAnthropicWithRetry(requestBody, apiKey);
  const durationMs = Date.now() - startTime;

  const response = aiResponse as { content?: { type: string; name?: string; input?: { missingItems?: MissingItem[] } }[]; usage?: Record<string, number> };
  const toolUse = response.content?.find((block) => block.type === "tool_use");

  // Log the verification call
  if (sessionId) {
    const tokens = extractTokenUsage(aiResponse as Record<string, unknown>);
    logApiCall({
      session_id: sessionId,
      edge_function: "extract-plan-items",
      step_label: batchLabel ? `${batchLabel} (Verification)` : `Chunk ${chunkIndex + 1}/${totalChunks} Verification`,
      model: "claude-opus-4-6",
      request_payload: requestBody as unknown as Record<string, unknown>,
      response_payload: aiResponse as Record<string, unknown>,
      input_tokens: tokens.input_tokens,
      output_tokens: tokens.output_tokens,
      duration_ms: durationMs,
      status: toolUse ? "success" : "error",
    });
  }

  if (!toolUse?.input?.missingItems) return [];
  return toolUse.input.missingItems;
}

function mergeVerifiedItems(items: unknown[], missingItems: MissingItem[]): void {
  for (const missing of missingItems) {
    const newItem = {
      name: missing.name,
      levelType: missing.levelType,
      description: missing.description,
      metricTarget: missing.metricTarget,
      metricUnit: missing.metricUnit,
    };

    if (!missing.parentName || missing.parentName === '') {
      items.push(newItem);
      continue;
    }

    const parent = findItemByName(items, missing.parentName);
    if (parent) {
      if (!parent.children) parent.children = [];
      const exists = parent.children.some(
        (c: { name?: string }) => c.name?.toLowerCase() === missing.name.toLowerCase()
      );
      if (!exists) {
        parent.children.push(newItem);
      }
    } else {
      items.push(newItem);
    }
  }
}

function findItemByName(items: unknown[], name: string): { children?: unknown[]; [key: string]: unknown } | null {
  const nameLower = name.toLowerCase();
  for (const item of items) {
    const i = item as { name?: string; children?: unknown[] };
    if (i.name?.toLowerCase() === nameLower) return i as { children?: unknown[]; [key: string]: unknown };
    if (i.children?.length) {
      const found = findItemByName(i.children, name);
      if (found) return found;
    }
  }
  return null;
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
    const { documentText, organizationName, industry, documentHints, planLevels, pageRange, sessionId: incomingSessionId, batchLabel } = body;

    console.log('[extract-plan-items] Received sessionId:', incomingSessionId);

    if (!documentText || typeof documentText !== "string") {
      return createSafeError(400, "Document text is required and must be a string.");
    }

    const trimmedText = documentText.trim();

    if (trimmedText.length < MIN_TEXT_LENGTH) {
      return createSafeError(400, `Document text too short. Minimum ${MIN_TEXT_LENGTH} characters required.`);
    }

    if (trimmedText.length > MAX_TEXT_LENGTH) {
      return createSafeError(413, `Document text too long. Maximum ${MAX_TEXT_LENGTH} characters allowed.`);
    }

    const sessionId = await ensureSession(incomingSessionId);
    console.log('[extract-plan-items] Resolved sessionId:', sessionId);

    const totalBulletMarkers = countBulletMarkers(trimmedText);
    const chunks = splitDocumentIntoChunks(trimmedText, CHUNK_SIZE);
    console.log(`Processing document: ${trimmedText.length} chars, ${chunks.length} chunk(s), ~${totalBulletMarkers} bullet markers`);

    let allItems: unknown[] = [];
    let finalDetectedLevels: { depth: number; name: string }[] = [];

    for (let i = 0; i < chunks.length; i++) {
      console.log(`Processing chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)`);

      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      const previousContext = i > 0 ? {
        detectedLevels: finalDetectedLevels,
        extractedItemNames: collectItemNames(allItems),
      } : null;

      try {
        const result = await processChunk(chunks[i], i, chunks.length, previousContext, ANTHROPIC_API_KEY, { organizationName, industry, documentHints, planLevels, pageRange }, sessionId, batchLabel);

        if (result.items?.length > 0) {
          allItems = [...allItems, ...result.items];
        }

        if (i === 0 && result.detectedLevels?.length > 0) {
          finalDetectedLevels = result.detectedLevels;
        }

        const chunkTotal = countAllItems(result.items || []);
        console.log(`Chunk ${i + 1}: ${result.items?.length || 0} top-level, ${chunkTotal} total items`);
      } catch (chunkError) {
        const err = chunkError as { status?: number; message?: string; details?: string };
        if (err.status === 429 || err.status === 402) {
          return createSafeError(err.status, err.message || 'Service error');
        }
        console.error(`Chunk ${i + 1} failed:`, err.details || err.message || chunkError);
        if (i === 0) {
          return createSafeError(500, 'Unable to process document. Please try again.', chunkError);
        }
      }
    }

    const totalExtracted = countAllItems(allItems);
    console.log(`Total extracted: ${allItems.length} top-level, ${totalExtracted} total items, ${finalDetectedLevels.length} levels, ~${totalBulletMarkers} bullet markers, from ${chunks.length} chunk(s)`);

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          items: allItems,
          detectedLevels: finalDetectedLevels,
        },
        chunksProcessed: chunks.length,
        totalItems: totalExtracted,
        bulletMarkersDetected: totalBulletMarkers,
        sessionId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return createSafeError(500, 'Unable to process document. Please try again.', error);
  }
});
