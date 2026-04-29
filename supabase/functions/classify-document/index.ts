import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { logApiCall, ensureSession, extractTokenUsage, truncateImagePayload } from "../_shared/logging.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ANTHROPIC_MAX_RETRIES = 4;
const ANTHROPIC_BASE_DELAY_MS = 3000;
const RETRYABLE_ANTHROPIC_STATUSES = new Set([429, 500, 502, 503, 529]);
const CLASSIFICATION_CHUNK_SIZE = 25;
const CLASSIFICATION_CHUNK_THRESHOLD = 50;

function createSafeError(status: number, publicMessage: string, internalDetails?: unknown): Response {
  if (internalDetails) {
    console.error('[Document Classification Error]', { timestamp: new Date().toISOString(), details: internalDetails });
  }
  return new Response(
    JSON.stringify({ success: false, error: publicMessage }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function callAnthropicWithRetry(apiKey: string, payload: Record<string, unknown>): Promise<Response> {
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt <= ANTHROPIC_MAX_RETRIES; attempt++) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!RETRYABLE_ANTHROPIC_STATUSES.has(response.status)) return response;
    lastResponse = response;
    if (attempt === ANTHROPIC_MAX_RETRIES) return response;
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
    const backoffMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : ANTHROPIC_BASE_DELAY_MS * Math.pow(2, attempt);
    console.warn(`Anthropic ${response.status}. Retrying in ${backoffMs}ms (attempt ${attempt + 1}/${ANTHROPIC_MAX_RETRIES + 1})`);
    await sleep(backoffMs);
  }
  return lastResponse ?? new Response("No response from AI provider", { status: 503 });
}

const CLASSIFICATION_SYSTEM_PROMPT = `You are a strategic plan document classifier. Your job is to analyze a document and produce a structured classification that will guide downstream AI agents in extracting plan items accurately.

You will receive page images from a document that supposedly contains a strategic plan. Analyze the document and return ONLY a JSON object (no markdown, no commentary) with the following structure:

{ "document_type": "text_heavy" | "tabular" | "presentation" | "mixed", "confidence": 0.0-1.0, "plan_content_pages": [list of 1-indexed page numbers containing actual plan items], "skip_pages": [list of 1-indexed page numbers to skip entirely], "page_annotations": [ { "page": 1, "classification": "cover" | "toc" | "background" | "methodology" | "vision_mission" | "swot" | "priorities_matrix" | "plan_content" | "gap_analysis" | "action_items" | "appendix" | "definitions" | "agenda" | "recommendations" | "blank" | "other", "contains_plan_items": true | false, "notes": "brief explanation" } ], "hierarchy_pattern": { "detected_levels": ["Level 1 Name", "Level 2 Name", "Level 3 Name"], "level_count": 3, "detection_method": "column_position" | "heading_nesting" | "numbering_scheme" | "indentation" | "explicit_labels" | "section_grouping", "notes": "explanation of how hierarchy was detected" }, "table_structure": null | { "column_to_level_mapping": [ {"column_header": "Pillar", "hierarchy_level": 1, "is_plan_item": true}, {"column_header": "Objective", "hierarchy_level": 2, "is_plan_item": true}, {"column_header": "Outcome KPIs", "hierarchy_level": null, "is_plan_item": false, "metadata_type": "kpi"}, {"column_header": "Strategies", "hierarchy_level": 3, "is_plan_item": true}, {"column_header": "Strategy KPIs", "hierarchy_level": null, "is_plan_item": false, "metadata_type": "kpi"} ], "has_merged_cells": true | false, "merged_cell_direction": "vertical" | "horizontal" | "both", "notes": "explanation of table layout" }, "extraction_recommendations": { "primary_method": "text" | "vision" | "table_vision", "fallback_method": "text" | "vision" | null, "page_range": "16-37" | null, "chunking_strategy": "by_page" | "by_section" | "by_table" | "full_document", "special_handling": [] }, "non_plan_content": { "has_vision_mission": true | false, "has_values_principles": true | false, "has_swot": true | false, "has_kpis_metrics": true | false, "has_gap_analysis": true | false, "has_action_items_with_metadata": true | false, "metadata_columns": [] } }

CLASSIFICATION RULES:

document_type:

"text_heavy": Primarily text paragraphs with headings, bullets, numbered lists. Plan structure comes from document outline/headings.

"tabular": Plan content is organized in tables/matrices where column position defines hierarchy level. Common in higher education and corporate strategic plans.

"presentation": Slide-deck format (PowerPoint-to-PDF) with decorative pages, infographics, and plan content scattered across specific slides. Common in government and consulting deliverables.

"mixed": Combination — e.g., presentation wrapper with tabular action item pages at the end.

CRITICAL CLASSIFICATION DECISION — "tabular" vs "text_heavy":

A document is "tabular" ONLY when the plan items themselves are organized as table rows — the tables ARE the plan structure, not supporting data. Examples: a strategic plan formatted as a spreadsheet where each row is a goal/strategy/action with columns for owner, timeline, KPIs.

A document is "text_heavy" even if it contains tables, as long as the plan items (goals, strategies, actions) are primarily expressed in narrative text, headings, and bullet points. Tables for metrics, timelines, budgets, or outcome tracking are supporting data — they do NOT make the document tabular.

Decision rule: If the document has both narrative text AND tables, ask: are the plan items primarily expressed in narrative text or primarily structured as table rows? If narrative text defines the plan and tables provide metrics/data, classify as "text_heavy."

Examples:
- "tabular": Strategic plan where each row is an action item with columns for goal, strategy, owner, timeline, KPI. The table IS the plan.
- "text_heavy": 50-page grant application with narrative sections describing goals and strategies, plus tables showing outcome metrics and timelines. The narrative IS the plan; tables are supporting data.
- "presentation": Slide deck with one goal per slide, visual layouts, large text.

page_annotations classification values:

"cover": Title page, organization branding, date

"toc": Table of contents

"background": Context, history, about the organization

"methodology": How the plan was developed, who participated, process description

"vision_mission": Vision statement, mission statement — these are NOT plan items

"swot": SWOT analysis — these are NOT plan items

"priorities_matrix": Priority ranking charts/matrices — these are NOT plan items

"plan_content": Pages with actual extractable strategic plan items (goals, objectives, strategies, action items, initiatives)

"gap_analysis": Gap analysis templates — may contain strategies but in non-standard format

"action_items": Detailed action item tables — these ARE plan items, usually the lowest level

"appendix": Supporting materials after the main plan

"definitions": Term definitions (e.g., "Pillar means..., Objective means...")

"agenda": Workshop/meeting agenda

"recommendations": Consultant recommendations about the planning process (not plan items)

"blank": Empty or nearly empty pages

hierarchy_pattern detection_method:

"column_position": Hierarchy defined by table column position (tabular documents)

"heading_nesting": Hierarchy follows document heading levels (H1 > H2 > H3)

"numbering_scheme": Items use hierarchical numbering (1.0, 1.1, 1.1.1)

"indentation": Visual indentation indicates parent-child relationships

"explicit_labels": Items explicitly labeled with level (e.g., "Goal 1:", "Objective 1.1:")

"section_grouping": Items grouped under section headers that define the parent level

CRITICAL DISTINCTIONS — what is NEVER a plan item:

Vision statements, mission statements, values, and principles — they are context

SWOT items (strengths, weaknesses, opportunities, threats)

Gap analysis "current state" and "desired state" descriptions — but gap closure STRATEGIES may be plan items

KPIs/metrics — they are metadata ABOUT plan items, not plan items themselves

Workshop agendas, participant lists, voting results, process descriptions

Consultant recommendations about the planning PROCESS (only recommendations that ARE the plan content qualify)

"Evidence of Success" lists — they are measurement criteria, not plan items

FOR TABULAR DOCUMENTS:

Column headers often directly name the hierarchy levels

Merged cells spanning multiple rows mean that value is a parent applying to all adjacent rows

Color coding or font styling indicates data availability or priority — this is metadata, not hierarchy

If the document includes a definitions page, map those definitions to hierarchy levels

The leftmost substantive column is typically the highest hierarchy level

FOR PRESENTATION/DESIGNED DOCUMENTS:

Many pages are decorative dividers (section headers with large text and images) — skip these

Look for pages where actual plan items are listed in bullet or numbered format

Action item tables at the end of presentations are usually the most structured source of plan items

Infographic-style pages (gap analysis arrows, priority matrices) contain information but are very hard to extract reliably — flag as low-confidence`;

function buildUserPrompt(
  orgName: string,
  industry: string,
  userPlanLevels: Array<{ level: number; name: string }> | null,
  pageRange: string | null,
  additionalNotes: string | null
): string {
  let prompt = `Classify this document for strategic plan extraction.\n\nOrganization: ${orgName}\nIndustry: ${industry}`;
  if (userPlanLevels && userPlanLevels.length > 0) {
    const formatted = userPlanLevels.map(l => `Level ${l.level}: ${l.name}`).join(", ");
    prompt += `\nUser-specified plan levels: ${formatted}`;
  }
  if (pageRange) {
    prompt += `\nUser-specified page range: ${pageRange}`;
  }
  // Note: additionalNotes intentionally NOT appended here — it is now prepended to the
  // system prompt as USER-PROVIDED CONTEXT (see buildUserContextBlock).
  prompt += `\n\nAnalyze all provided page images and return ONLY the JSON classification object.`;
  return prompt;
}

// duplicated in 5 agents; keep in sync
function buildUserContextBlock(notes?: string | null): string {
  const t = (notes ?? "").trim();
  if (!t) return "";
  return `USER-PROVIDED CONTEXT (treat as authoritative guidance about this specific document):\n${t}\n\n`;
}

function buildImageContent(pageImages: string[]): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [];
  for (let i = 0; i < pageImages.length; i++) {
    let base64Data = pageImages[i];
    let mediaType = "image/png";
    const match = base64Data.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (match) {
      mediaType = match[1];
      base64Data = match[2];
    }
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType,
        data: base64Data,
      },
    });
  }
  return content;
}

function buildFallbackClassification(pageCount: number): Record<string, unknown> {
  return {
    document_type: "text_heavy",
    confidence: 0.0,
    plan_content_pages: Array.from({ length: pageCount }, (_, i) => i + 1),
    skip_pages: [],
    page_annotations: Array.from({ length: pageCount }, (_, i) => ({
      page: i + 1,
      classification: "plan_content",
      contains_plan_items: true,
      notes: "Fallback — classification failed",
    })),
    hierarchy_pattern: {
      detected_levels: [],
      level_count: 0,
      detection_method: "heading_nesting",
      notes: "Classification failed — using defaults",
    },
    table_structure: null,
    extraction_recommendations: {
      primary_method: "vision",
      fallback_method: "text",
      page_range: null,
      chunking_strategy: "by_page",
      special_handling: [],
    },
    non_plan_content: {
      has_vision_mission: false,
      has_values_principles: false,
      has_swot: false,
      has_kpis_metrics: false,
      has_gap_analysis: false,
      has_action_items_with_metadata: false,
      metadata_columns: [],
    },
    _fallback: true,
  };
}

function buildFallbackAnnotationsForPages(startPage: number, endPage: number): Array<Record<string, unknown>> {
  const annotations: Array<Record<string, unknown>> = [];
  for (let p = startPage; p <= endPage; p++) {
    annotations.push({
      page: p,
      classification: "plan_content",
      contains_plan_items: true,
      notes: "Chunk classification failed — conservatively marked as plan content",
    });
  }
  return annotations;
}

async function classifyChunk(
  chunkImages: string[],
  chunkIndex: number,
  pageOffset: number,
  totalPages: number,
  apiKey: string,
  baseUserPrompt: string,
  sessionId: string,
  additionalNotes: string | null,
): Promise<{ classification: Record<string, unknown>; inputTokens: number; outputTokens: number } | null> {
  const startPage = pageOffset + 1;
  const endPage = pageOffset + chunkImages.length;

  const chunkPrompt = `${baseUserPrompt}\n\nNote: These are pages ${startPage}-${endPage} of ${totalPages} total pages. Return page numbers using the original document numbering (starting from ${startPage}).`;

  const userContent: Array<Record<string, unknown>> = [
    { type: "text", text: chunkPrompt },
    ...buildImageContent(chunkImages),
  ];

  const requestBody = {
    model: "claude-opus-4-6",
    max_tokens: 4096,
    system: `${buildUserContextBlock(additionalNotes)}${CLASSIFICATION_SYSTEM_PROMPT}`,
    messages: [{ role: "user", content: userContent }],
  };

  const startTime = Date.now();
  const response = await callAnthropicWithRetry(apiKey, requestBody);
  const durationMs = Date.now() - startTime;
  const logPayload = truncateImagePayload(requestBody as Record<string, unknown>);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[classify-document] Chunk ${chunkIndex} (pages ${startPage}-${endPage}) failed: ${response.status}`, errorText.slice(0, 500));
    await logApiCall({
      session_id: sessionId,
      edge_function: "classify-document",
      step_label: `Step 0: Classification chunk ${chunkIndex} (pages ${startPage}-${endPage})`,
      model: "claude-opus-4-6",
      request_payload: logPayload,
      response_payload: { status: response.status, error: errorText.slice(0, 2000) },
      duration_ms: durationMs,
      status: "error",
      error_message: `Claude API ${response.status}: ${errorText.slice(0, 500)}`,
    });
    return null;
  }

  const responseData = await response.json();
  const tokenUsage = extractTokenUsage(responseData as Record<string, unknown>);

  let responseText = "";
  if (responseData.content && Array.isArray(responseData.content)) {
    for (const block of responseData.content) {
      if (block.type === "text") responseText += block.text;
    }
  }

  let classification: Record<string, unknown>;
  try {
    let jsonStr = responseText.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }
    classification = JSON.parse(jsonStr);
  } catch (parseError) {
    console.error(`[classify-document] Chunk ${chunkIndex} JSON parse failed:`, parseError);
    await logApiCall({
      session_id: sessionId,
      edge_function: "classify-document",
      step_label: `Step 0: Classification chunk ${chunkIndex} (pages ${startPage}-${endPage})`,
      model: "claude-opus-4-6",
      request_payload: logPayload,
      response_payload: { raw_response: responseText.slice(0, 5000), parse_error: String(parseError) },
      input_tokens: tokenUsage.input_tokens,
      output_tokens: tokenUsage.output_tokens,
      duration_ms: durationMs,
      status: "error",
      error_message: `JSON parse failed: ${String(parseError).slice(0, 200)}`,
    });
    return null;
  }

  await logApiCall({
    session_id: sessionId,
    edge_function: "classify-document",
    step_label: `Step 0: Classification chunk ${chunkIndex} (pages ${startPage}-${endPage})`,
    model: "claude-opus-4-6",
    request_payload: logPayload,
    response_payload: classification,
    input_tokens: tokenUsage.input_tokens,
    output_tokens: tokenUsage.output_tokens,
    duration_ms: durationMs,
    status: "success",
  });

  console.log(`[classify-document] Chunk ${chunkIndex} (pages ${startPage}-${endPage}) classified: type=${classification.document_type}, confidence=${classification.confidence}`);
  return { classification, inputTokens: tokenUsage.input_tokens ?? 0, outputTokens: tokenUsage.output_tokens ?? 0 };
}

function mergeClassifications(results: Array<Record<string, unknown>>): Record<string, unknown> {
  if (results.length === 1) return results[0];

  // page_annotations: concatenate
  const allAnnotations: unknown[] = [];
  const allPlanPages: number[] = [];
  const allSkipPages: number[] = [];

  // document_type majority vote
  const typeCounts: Record<string, number> = {};
  let totalConfidence = 0;
  let highestConfidenceIdx = 0;
  let highestConfidence = -1;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const annotations = (r.page_annotations as unknown[]) || [];
    allAnnotations.push(...annotations);
    const planPages = (r.plan_content_pages as number[]) || [];
    allPlanPages.push(...planPages);
    const skipPages = (r.skip_pages as number[]) || [];
    allSkipPages.push(...skipPages);

    const dt = (r.document_type as string) || "text_heavy";
    typeCounts[dt] = (typeCounts[dt] || 0) + 1;

    const conf = (r.confidence as number) || 0;
    totalConfidence += conf;
    if (conf > highestConfidence) {
      highestConfidence = conf;
      highestConfidenceIdx = i;
    }
  }

  // Majority vote for document_type
  let majorityType = "text_heavy";
  let maxCount = 0;
  for (const [type, count] of Object.entries(typeCounts)) {
    if (count > maxCount) { maxCount = count; majorityType = type; }
  }

  // table_structure: first non-null
  let tableStructure = null;
  for (const r of results) {
    if (r.table_structure) { tableStructure = r.table_structure; break; }
  }

  // non_plan_content: OR-merge booleans, concat metadata_columns
  const nonPlan: Record<string, unknown> = {
    has_vision_mission: false,
    has_values_principles: false,
    has_swot: false,
    has_kpis_metrics: false,
    has_gap_analysis: false,
    has_action_items_with_metadata: false,
    metadata_columns: [] as string[],
  };
  for (const r of results) {
    const np = r.non_plan_content as Record<string, unknown> | undefined;
    if (!np) continue;
    for (const key of ["has_vision_mission", "has_values_principles", "has_swot", "has_kpis_metrics", "has_gap_analysis", "has_action_items_with_metadata"]) {
      if (np[key]) nonPlan[key] = true;
    }
    const cols = (np.metadata_columns as string[]) || [];
    (nonPlan.metadata_columns as string[]).push(...cols);
  }
  // dedupe metadata_columns
  nonPlan.metadata_columns = [...new Set(nonPlan.metadata_columns as string[])];

  const best = results[highestConfidenceIdx];

  return {
    document_type: majorityType,
    confidence: results.length > 0 ? totalConfidence / results.length : 0,
    plan_content_pages: [...new Set(allPlanPages)].sort((a, b) => a - b),
    skip_pages: [...new Set(allSkipPages)].sort((a, b) => a - b),
    page_annotations: allAnnotations,
    hierarchy_pattern: best.hierarchy_pattern || results[0].hierarchy_pattern,
    table_structure: tableStructure,
    extraction_recommendations: best.extraction_recommendations || results[0].extraction_recommendations,
    non_plan_content: nonPlan,
    _chunked: true,
    _chunk_count: results.length,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return createSafeError(500, "Service configuration error. Please contact administrator.", "ANTHROPIC_API_KEY not set");
    }

    const body = await req.json();
    const {
      pageImages,
      orgName = "Unknown",
      industry = "Unknown",
      userPlanLevels = null,
      pageRange = null,
      additionalNotes = null,
      sessionId: incomingSessionId,
    } = body;

    console.log("[classify-document] Received sessionId:", incomingSessionId, "pages:", pageImages?.length);

    if (!pageImages || !Array.isArray(pageImages) || pageImages.length === 0) {
      return createSafeError(400, "Page images are required as a non-empty array.");
    }

    for (let i = 0; i < pageImages.length; i++) {
      if (typeof pageImages[i] !== "string") {
        return createSafeError(400, `Invalid image data at index ${i}. Expected base64 string.`);
      }
      if (pageImages[i].length > MAX_IMAGE_SIZE) {
        return createSafeError(413, `Image at index ${i} exceeds 5MB size limit.`);
      }
    }

    const sessionId = await ensureSession(incomingSessionId);
    const pageCount = pageImages.length;
    const userPrompt = buildUserPrompt(orgName, industry, userPlanLevels, pageRange, additionalNotes);

    // ── Single-request path (≤ threshold) ──
    if (pageCount <= CLASSIFICATION_CHUNK_THRESHOLD) {
      const userContent: Array<Record<string, unknown>> = [
        { type: "text", text: userPrompt },
        ...buildImageContent(pageImages),
      ];

      const requestBody = {
        model: "claude-opus-4-6",
        max_tokens: 4096,
        system: CLASSIFICATION_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      };

      const startTime = Date.now();
      const response = await callAnthropicWithRetry(ANTHROPIC_API_KEY, requestBody);
      const durationMs = Date.now() - startTime;
      const logPayload = truncateImagePayload(requestBody as Record<string, unknown>);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[classify-document] Claude API error:", response.status, errorText);
        await logApiCall({
          session_id: sessionId,
          edge_function: "classify-document",
          step_label: "Step 0: Document Classification",
          model: "claude-opus-4-6",
          request_payload: logPayload,
          response_payload: { status: response.status, error: errorText.slice(0, 2000) },
          duration_ms: durationMs,
          status: "error",
          error_message: `Claude API ${response.status}: ${errorText.slice(0, 500)}`,
        });
        const fallback = buildFallbackClassification(pageCount);
        return new Response(
          JSON.stringify({ success: true, classification: fallback }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const responseData = await response.json();
      const tokenUsage = extractTokenUsage(responseData as Record<string, unknown>);

      let responseText = "";
      if (responseData.content && Array.isArray(responseData.content)) {
        for (const block of responseData.content) {
          if (block.type === "text") responseText += block.text;
        }
      }

      let classification: Record<string, unknown>;
      try {
        let jsonStr = responseText.trim();
        if (jsonStr.startsWith("```")) {
          jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
        }
        classification = JSON.parse(jsonStr);
      } catch (parseError) {
        console.error("[classify-document] JSON parse failed:", parseError, "Raw response:", responseText.slice(0, 1000));
        await logApiCall({
          session_id: sessionId,
          edge_function: "classify-document",
          step_label: "Step 0: Document Classification",
          model: "claude-opus-4-6",
          request_payload: logPayload,
          response_payload: { raw_response: responseText.slice(0, 5000), parse_error: String(parseError) },
          input_tokens: tokenUsage.input_tokens,
          output_tokens: tokenUsage.output_tokens,
          duration_ms: durationMs,
          status: "error",
          error_message: `JSON parse failed: ${String(parseError).slice(0, 200)}`,
        });
        classification = buildFallbackClassification(pageCount);
      }

      await logApiCall({
        session_id: sessionId,
        edge_function: "classify-document",
        step_label: "Step 0: Document Classification",
        model: "claude-opus-4-6",
        request_payload: logPayload,
        response_payload: classification,
        input_tokens: tokenUsage.input_tokens,
        output_tokens: tokenUsage.output_tokens,
        duration_ms: durationMs,
        status: "success",
      });

      console.log("[classify-document] Classification complete:", classification.document_type, "confidence:", classification.confidence);

      return new Response(
        JSON.stringify({ success: true, classification }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Chunked path (> threshold) ──
    const chunks: string[][] = [];
    for (let i = 0; i < pageCount; i += CLASSIFICATION_CHUNK_SIZE) {
      chunks.push(pageImages.slice(i, i + CLASSIFICATION_CHUNK_SIZE));
    }

    console.log(`[classify-document] Chunked classification: ${chunks.length} chunks of ${CLASSIFICATION_CHUNK_SIZE} for ${pageCount} pages`);

    const chunkResults: Array<Record<string, unknown>> = [];
    let succeededChunks = 0;
    let failedChunks = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const chunkedStartTime = Date.now();

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunkImages = chunks[ci];
      const pageOffset = ci * CLASSIFICATION_CHUNK_SIZE;
      const startPage = pageOffset + 1;
      const endPage = pageOffset + chunkImages.length;

      const result = await classifyChunk(
        chunkImages, ci, pageOffset, pageCount,
        ANTHROPIC_API_KEY, userPrompt, sessionId, additionalNotes,
      );

      if (result) {
        chunkResults.push(result.classification);
        totalInputTokens += result.inputTokens;
        totalOutputTokens += result.outputTokens;
        succeededChunks++;
      } else {
        console.warn(`[classify-document] Chunk ${ci} (pages ${startPage}-${endPage}) failed — using conservative fallback for those pages`);
        failedChunks++;
        // Build a minimal classification with fallback annotations for this chunk's pages
        chunkResults.push({
          document_type: "text_heavy",
          confidence: 0.0,
          plan_content_pages: Array.from({ length: chunkImages.length }, (_, j) => startPage + j),
          skip_pages: [],
          page_annotations: buildFallbackAnnotationsForPages(startPage, endPage),
          hierarchy_pattern: null,
          table_structure: null,
          extraction_recommendations: null,
          non_plan_content: null,
        });
      }
    }

    const totalDurationMs = Date.now() - chunkedStartTime;
    console.log(`[classify-document] Chunked classification complete: ${succeededChunks}/${chunks.length} chunks succeeded, ${failedChunks} failed, in ${totalDurationMs}ms`);

    const mergedClassification = mergeClassifications(chunkResults);

    // Log the merged result
    await logApiCall({
      session_id: sessionId,
      edge_function: "classify-document",
      step_label: "Step 0: Document Classification (merged)",
      model: "claude-opus-4-6",
      request_payload: { chunked: true, chunk_count: chunks.length, page_count: pageCount, succeeded: succeededChunks, failed: failedChunks },
      response_payload: mergedClassification,
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      duration_ms: totalDurationMs,
      status: failedChunks === chunks.length ? "error" : "success",
      error_message: failedChunks > 0 ? `${failedChunks}/${chunks.length} chunks failed` : undefined,
    });

    console.log("[classify-document] Merged classification:", mergedClassification.document_type, "confidence:", mergedClassification.confidence);

    return new Response(
      JSON.stringify({ success: true, classification: mergedClassification }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[classify-document] Unexpected error:", error);
    return createSafeError(500, "An unexpected error occurred during document classification.", error);
  }
});
