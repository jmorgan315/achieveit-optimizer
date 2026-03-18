import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { logApiCall, ensureSession, extractTokenUsage } from "../_shared/logging.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_SOURCE_LENGTH = 180000;

const AUDIT_SYSTEM_PROMPT = `You are a completeness auditor for strategic plan extraction. Your ONLY job is to compare extracted plan items against the source document and identify anything that was MISSED, INCORRECTLY MERGED, or REPHRASED.

You are NOT re-extracting the document. You are AUDITING an existing extraction for accuracy and completeness.

=== YOUR PROCESS ===

1. Read through the source document section by section
2. For each identifiable plan item in the source, check if it appears in the extracted items
3. Flag items that are MISSING from the extraction entirely
4. Flag items that appear to have been MERGED (where 2+ distinct items became 1)
5. Flag items where the NAME doesn't match the source text (was rephrased, shortened, or summarized)

=== WHAT COUNTS AS A "PLAN ITEM" ===

- Strategic priorities, pillars, themes
- Objectives, goals, focus areas
- Strategies, initiatives, actions, action items
- KPIs, metrics, measures, targets
- Any numbered or bulleted item under a heading that represents trackable work

=== WHAT IS NOT A PLAN ITEM (DO NOT FLAG AS MISSING) ===

- Table of contents entries, page numbers, headers, footers
- Mission/vision statements, organizational values
- Background narrative, introductory paragraphs
- Demographic data, population statistics
- Image captions, chart titles
- Previous year achievements (unless they set baselines)

=== REPHRASING DETECTION ===

Compare the 'name' field of each extracted item against the source text. If the source says "Increase year-over-year revenue growth by 15% through strategic market expansion" but the extracted item says "Increase revenue growth", that is a REPHRASED item. Flag it with both the extracted name and the original text.

=== MERGE DETECTION ===

If you see 3 distinct bullets in the source but only 1 item in the extraction that seems to cover all 3, that's a MERGED item. Flag it with the extracted item and the original individual items.

Be thorough but precise. Only flag genuine issues — do not flag items that are correctly extracted with minor formatting differences.`;

const auditToolSchema = {
  type: "object",
  properties: {
    missingItems: {
      type: "array",
      description: "Items present in the source document but completely absent from the extraction",
      items: {
        type: "object",
        properties: {
          sourceText: { type: "string", description: "Exact text from the source document for this item" },
          approximateLocation: { type: "string", description: "Where in the document this item appears (e.g., 'Under section Strategic Priority 2, after item about...')" },
          suggestedParentId: { type: "string", description: "ID of the likely parent item in the extraction, if identifiable" },
          suggestedLevel: { type: "string", description: "The hierarchy level this item should be at (e.g., 'Goal', 'Strategy', 'KPI')" },
        },
        required: ["sourceText", "approximateLocation", "suggestedLevel"],
      },
    },
    mergedItems: {
      type: "array",
      description: "Items in the extraction that appear to be merges of 2+ distinct source items",
      items: {
        type: "object",
        properties: {
          extractedItemId: { type: "string", description: "ID of the extracted item that seems to be a merge" },
          extractedItemName: { type: "string", description: "Name of the merged extracted item" },
          originalItems: {
            type: "array",
            items: { type: "string" },
            description: "The distinct original item texts from the source document",
          },
          approximateLocation: { type: "string", description: "Where in the document these items appear" },
        },
        required: ["extractedItemName", "originalItems", "approximateLocation"],
      },
    },
    rephrasedItems: {
      type: "array",
      description: "Items where the extracted name doesn't match the source document text",
      items: {
        type: "object",
        properties: {
          extractedItemId: { type: "string", description: "ID of the extracted item" },
          extractedName: { type: "string", description: "What Agent 1 wrote as the name" },
          originalText: { type: "string", description: "What the document actually says" },
        },
        required: ["extractedName", "originalText"],
      },
    },
    auditSummary: {
      type: "object",
      description: "Summary statistics of the audit",
      properties: {
        totalSourceItems: { type: "number", description: "Approximate total identifiable plan items in the source document" },
        totalExtractedItems: { type: "number", description: "Total items in the extraction" },
        missingCount: { type: "number" },
        mergedCount: { type: "number" },
        rephrasedCount: { type: "number" },
      },
      required: ["totalSourceItems", "totalExtractedItems", "missingCount", "mergedCount", "rephrasedCount"],
    },
  },
  required: ["missingItems", "mergedItems", "rephrasedItems", "auditSummary"],
};

function flattenItems(items: unknown[], prefix = ""): string[] {
  const lines: string[] = [];
  for (const item of items) {
    const i = item as { id?: string; name?: string; levelType?: string; levelName?: string; children?: unknown[] };
    const id = i.id || "?";
    const name = i.name || "(unnamed)";
    const level = i.levelType || i.levelName || "?";
    lines.push(`${prefix}[${id}] (${level}) ${name}`);
    if (i.children?.length) {
      lines.push(...flattenItems(i.children, prefix + "  "));
    }
  }
  return lines;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ success: false, error: "Service configuration error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { sourceText, extractedItems, sessionId: incomingSessionId, organizationName, industry, planLevels } = body;

    if (!sourceText || !extractedItems) {
      return new Response(JSON.stringify({ success: false, error: "sourceText and extractedItems are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sessionId = await ensureSession(incomingSessionId);
    console.log("[audit-completeness] sessionId:", sessionId);

    let truncatedText = sourceText;
    let truncationNote = "";
    if (sourceText.length > MAX_SOURCE_LENGTH) {
      truncatedText = sourceText.slice(0, MAX_SOURCE_LENGTH);
      truncationNote = "\n\n[NOTE: Document was truncated for analysis. Some items near the end may not be auditable.]";
      console.log(`[audit-completeness] Source text truncated from ${sourceText.length} to ${MAX_SOURCE_LENGTH} chars`);
    }

    const itemListing = flattenItems(extractedItems).join("\n");

    let contextPrefix = "";
    if (organizationName || industry) {
      const parts: string[] = [];
      if (organizationName) parts.push(`Organization: ${organizationName}`);
      if (industry) parts.push(`Industry: ${industry}`);
      contextPrefix = `ORGANIZATION CONTEXT:\n${parts.join("\n")}\n\n`;
    }

    const userMessage = `${contextPrefix}=== EXTRACTED ITEMS (${extractedItems.length} top-level) ===

${itemListing}

=== SOURCE DOCUMENT ===

${truncatedText}${truncationNote}

Please audit the extraction above against the source document. Identify any missing items, merged items, or rephrased items.`;

    const requestBody = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 16384,
      system: AUDIT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      tools: [{
        name: "report_audit_findings",
        description: "Report completeness audit findings comparing extraction against source document",
        input_schema: auditToolSchema,
      }],
      tool_choice: { type: "tool", name: "report_audit_findings" },
    };

    const startTime = Date.now();
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
    const durationMs = Date.now() - startTime;

    if (!response.ok) {
      const errText = await response.text();
      console.error("[audit-completeness] Anthropic error:", response.status, errText);

      logApiCall({
        session_id: sessionId,
        edge_function: "audit-completeness",
        step_label: "Agent 2: Completeness Audit",
        model: "claude-sonnet-4-20250514",
        duration_ms: durationMs,
        status: "error",
        error_message: `Anthropic ${response.status}: ${errText.slice(0, 500)}`,
      });

      return new Response(JSON.stringify({ success: false, error: "Audit processing failed" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResponse = await response.json();
    const tokens = extractTokenUsage(aiResponse);

    const toolUse = aiResponse.content?.find((b: { type: string }) => b.type === "tool_use");

    logApiCall({
      session_id: sessionId,
      edge_function: "audit-completeness",
      step_label: "Agent 2: Completeness Audit",
      model: "claude-sonnet-4-20250514",
      request_payload: { sourceTextLength: sourceText.length, extractedItemCount: extractedItems.length },
      response_payload: aiResponse,
      input_tokens: tokens.input_tokens,
      output_tokens: tokens.output_tokens,
      duration_ms: durationMs,
      status: toolUse ? "success" : "error",
      error_message: toolUse ? undefined : "No tool_use in response",
    });

    if (!toolUse) {
      return new Response(JSON.stringify({ success: false, error: "Audit returned unexpected format" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const auditFindings = toolUse.input;
    console.log("[audit-completeness] Findings:", JSON.stringify(auditFindings.auditSummary));

    return new Response(JSON.stringify({ success: true, data: auditFindings, sessionId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[audit-completeness] Error:", error);
    return new Response(JSON.stringify({ success: false, error: "Audit failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
