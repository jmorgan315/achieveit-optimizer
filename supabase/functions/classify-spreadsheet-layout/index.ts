import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logApiCall, extractTokenUsage, callAnthropicWithRetry } from "../_shared/logging.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MODEL = "claude-sonnet-4-6";
const MAX_ROWS = 30;
const MAX_COLS = 12;
const MAX_CELL_LEN = 80;
const SHEET_CHUNK = 5;

interface SheetPreview {
  sheetName: string;
  rows: (string | number | null)[][];
}

const PATTERN_GUIDE = `You are classifying the structural layout of strategic-plan spreadsheets so a downstream parser can dispatch the right extraction routine. You are NOT extracting plan content — only describing structure.

=== PATTERNS ===

A — Form / section-block
  Section headers like "Strategy:" or "Goal:" appear in their own row, with related rows beneath them. Column meanings often shift between sections. Multiple section blocks per sheet.

B — Flat list with hierarchy column(s)
  One row per item. The level (Goal / Strategy / Action / Measurement) is encoded in a column (e.g., a "Type" or "Level" column) or by indentation in the name column.

C — Column-nested
  Hierarchy is encoded across columns: Strategy column → Outcome column → Action column on the same row. Each row often represents a leaf with its full ancestor chain repeated.

D — Pivot / scorecard
  Metrics in rows, time periods or owners in columns (Q1, Q2, FY25, etc.). KPI-style.

not_plan_content — README, config, dept lookup, budget tab, raw scratch data — present but NOT plan items.
empty — sheet has no extractable content.
unknown — genuinely ambiguous; explain why.

=== STRUCTURE FIELDS (per sheet) ===

- header_row_index: 0-based row index of the column header row (or section header row for pattern A). null if not applicable.
- data_starts_at_row: 0-based row index where the first data row begins.
- name_column_index: 0-based column index that holds the primary item name. null if structure makes this ambiguous.
- hierarchy_signal: how hierarchy is encoded. One of "section_headers" | "category_columns" | "column_nested" | "pivot_rows".
- implied_levels: ordered array of level names you infer (e.g., ["Strategy", "Outcome", "Action"]).
- section_marker_pattern: regex-ish pattern that identifies section headers in pattern A (e.g., "^(Strategy|Goal):"). null otherwise.

=== WORKBOOK SUMMARY ===

- primary_pattern: the dominant pattern across plan-content sheets, or "mixed".
- needs_user_clarification: true when the workbook has multiple time-versioned sheets (Jan / Feb / Mar, FY24 / FY25), scope variations, or many similar sheets where the user must choose which to import.
- clarification_reason: short human-readable reason when needs_user_clarification is true.
- clarification_type: one of "time_versioning" | "scope_variation" | "ambiguous_pattern" | "mixed_patterns" | "other". Set ONLY when needs_user_clarification is true. Use "mixed_patterns" when sheets have genuinely different structural patterns. Use "time_versioning" for date/period-based duplicates. Use "scope_variation" for similar sheets covering different scopes (departments, regions). Use "ambiguous_pattern" when individual sheets are themselves hard to classify. Otherwise "other".

=== PARSER DIRECTIVES ===

parser_directives describes ONLY what the user told us in their notes (documentHints). It is NOT derived from sheet structure — that is what per-sheet "pattern" is for. If documentHints is empty or contains no exclusion/scope language, ALL fields are empty/false.

A sheet structurally classified as "not_plan_content" does NOT belong in exclude_sheets — that's already conveyed by its pattern. Only put a sheet in exclude_sheets if the user's notes explicitly say to skip it (e.g., "ignore the budget tab", "skip last year's data").

- exclude_sheets: string[] — sheet names the user's notes explicitly say to skip. Each entry MUST be the exact canonical sheet name as it appears in the workbook (matching one of the sheetName values in the input). Do NOT include the user's phrasing, paraphrases, or case variants. If the user's note refers to a sheet by an approximate name, resolve it to the single canonical sheet name. Deduplicate. Empty by default.
- exclude_row_predicates: string[] — human-readable row filters from the user's notes (e.g., "rows where status = Archived"). Empty by default.
- include_only_recent: boolean — true ONLY when the user explicitly asks for the latest/most-recent version ("just the latest", "current year only"). False by default. The classifier may still flag time-versioning structurally via clarification_type without setting this.

Be precise. Respond ONLY via the report_layout tool.`;

const layoutToolSchema = {
  type: "object",
  properties: {
    workbook_summary: {
      type: "object",
      properties: {
        primary_pattern: { type: "string", enum: ["A", "B", "C", "D", "mixed"] },
        needs_user_clarification: { type: "boolean" },
        clarification_reason: { type: "string" },
        clarification_type: {
          type: ["string", "null"],
          enum: ["time_versioning", "scope_variation", "ambiguous_pattern", "mixed_patterns", "other", null],
          description: "Set only when needs_user_clarification is true; null otherwise.",
        },
      },
      required: ["primary_pattern", "needs_user_clarification"],
    },
    parser_directives: {
      type: "object",
      description: "Derived strictly from documentHints. Empty/false when no hints provided.",
      properties: {
        exclude_sheets: { type: "array", items: { type: "string" } },
        exclude_row_predicates: { type: "array", items: { type: "string" } },
        include_only_recent: { type: "boolean" },
      },
      required: ["exclude_sheets", "exclude_row_predicates", "include_only_recent"],
    },
    sheets: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sheet_name: { type: "string" },
          pattern: {
            type: "string",
            enum: ["A", "B", "C", "D", "not_plan_content", "empty", "unknown"],
          },
          confidence: { type: "number", description: "0-100" },
          reasoning: { type: "string" },
          structure: {
            type: "object",
            properties: {
              header_row_index: { type: ["number", "null"] },
              data_starts_at_row: { type: ["number", "null"] },
              name_column_index: { type: ["number", "null"] },
              hierarchy_signal: {
                type: ["string", "null"],
                enum: ["section_headers", "category_columns", "column_nested", "pivot_rows", null],
              },
              implied_levels: { type: "array", items: { type: "string" } },
              section_marker_pattern: { type: ["string", "null"] },
            },
          },
        },
        required: ["sheet_name", "pattern", "confidence", "reasoning"],
      },
    },
  },
  required: ["workbook_summary", "parser_directives", "sheets"],
};

function truncatePreview(sheets: SheetPreview[]): SheetPreview[] {
  return sheets.map(s => ({
    sheetName: s.sheetName,
    rows: (s.rows || []).slice(0, MAX_ROWS).map(row =>
      (row || []).slice(0, MAX_COLS).map(cell => {
        if (cell == null) return null;
        const str = typeof cell === "string" ? cell : String(cell);
        return str.length > MAX_CELL_LEN ? str.slice(0, MAX_CELL_LEN) + "…" : str;
      }),
    ),
  }));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildUserMessage(
  orgName: string | undefined,
  documentHints: string | undefined,
  chunkSheets: SheetPreview[],
  totalSheets: number,
  chunkIndex: number,
  chunkCount: number,
): string {
  const ctx: string[] = [];
  if (orgName) ctx.push(`Organization: ${orgName}`);
  if (documentHints?.trim()) ctx.push(`User-provided context: ${documentHints.trim()}`);
  ctx.push(`Total sheets in workbook: ${totalSheets}`);
  ctx.push(`This request covers chunk ${chunkIndex + 1} of ${chunkCount} (${chunkSheets.length} sheet(s)).`);

  const blocks = chunkSheets.map(s => {
    const grid = s.rows.map(r => r.map(c => (c == null ? "" : String(c))).join(" | ")).join("\n");
    return `--- SHEET: ${s.sheetName} ---\n${grid || "(empty)"}\n`;
  });

  return `${ctx.join("\n")}\n\nClassify each sheet below. For workbook_summary, base it ONLY on the sheets in this chunk; the caller will merge across chunks.\n\n${blocks.join("\n")}`;
}

async function callClaude(
  apiKey: string,
  userMessage: string,
): Promise<{ ok: boolean; data?: any; raw?: any; tokens: { input_tokens?: number; output_tokens?: number }; durationMs: number; error?: string }> {
  const startTime = Date.now();
  const requestBody = {
    model: MODEL,
    max_tokens: 8192,
    system: PATTERN_GUIDE,
    messages: [{ role: "user", content: userMessage }],
    tools: [{
      name: "report_layout",
      description: "Report structural layout classification for spreadsheet sheets",
      input_schema: layoutToolSchema,
    }],
    tool_choice: { type: "tool", name: "report_layout" },
  };

  try {
    const resp = await callAnthropicWithRetry("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
    const durationMs = Date.now() - startTime;

    if (!resp.ok) {
      const errText = await resp.text();
      return { ok: false, tokens: {}, durationMs, error: `Anthropic ${resp.status}: ${errText.slice(0, 500)}` };
    }
    const json = await resp.json();
    const tokens = extractTokenUsage(json);
    const toolUse = json.content?.find((b: { type: string }) => b.type === "tool_use");
    if (!toolUse) {
      return { ok: false, tokens, durationMs, raw: json, error: "No tool_use in response" };
    }
    return { ok: true, data: toolUse.input, raw: json, tokens, durationMs };
  } catch (e) {
    return { ok: false, tokens: {}, durationMs: Date.now() - startTime, error: e instanceof Error ? e.message : String(e) };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let sessionId: string | undefined;

  try {
    const body = await req.json();
    sessionId = body.sessionId;
    const orgName: string | undefined = body.orgName;
    const documentHints: string | undefined = body.documentHints;
    const workbookPreview: SheetPreview[] = body.workbookPreview;

    if (!sessionId || !Array.isArray(workbookPreview) || workbookPreview.length === 0) {
      return new Response(JSON.stringify({ success: false, error: "sessionId and workbookPreview required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      console.error("[classify-layout] ANTHROPIC_API_KEY missing");
      await persistSentinel(supabase, sessionId, "ANTHROPIC_API_KEY missing");
      return new Response(JSON.stringify({ success: false, error: "Service configuration error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const truncated = truncatePreview(workbookPreview);
    const totalSheets = truncated.length;
    const chunks = chunk(truncated, SHEET_CHUNK);

    console.log(`[classify-layout] session=${sessionId} sheets=${totalSheets} chunks=${chunks.length}`);

    const allSheets: any[] = [];
    const summaries: any[] = [];
    const directivesList: any[] = [];
    let totalIn = 0;
    let totalOut = 0;
    let totalDuration = 0;
    const startedAt = new Date().toISOString();

    for (let i = 0; i < chunks.length; i++) {
      const userMessage = buildUserMessage(orgName, documentHints, chunks[i], totalSheets, i, chunks.length);
      const result = await callClaude(ANTHROPIC_API_KEY, userMessage);

      logApiCall({
        session_id: sessionId,
        edge_function: "classify-spreadsheet-layout",
        step_label: "classify_layout",
        model: MODEL,
        request_payload: { chunkIndex: i, chunkCount: chunks.length, sheetNames: chunks[i].map(s => s.sheetName), orgName, documentHints },
        response_payload: result.raw,
        input_tokens: result.tokens.input_tokens,
        output_tokens: result.tokens.output_tokens,
        duration_ms: result.durationMs,
        status: result.ok ? "success" : "error",
        error_message: result.error,
      });

      totalIn += result.tokens.input_tokens || 0;
      totalOut += result.tokens.output_tokens || 0;
      totalDuration += result.durationMs;

      if (result.ok && result.data) {
        if (Array.isArray(result.data.sheets)) allSheets.push(...result.data.sheets);
        if (result.data.workbook_summary) summaries.push(result.data.workbook_summary);
        if (result.data.parser_directives) directivesList.push(result.data.parser_directives);
      } else {
        // Stub failed sheets so the user sees something
        for (const s of chunks[i]) {
          allSheets.push({
            sheet_name: s.sheetName,
            pattern: "unknown",
            confidence: 0,
            reasoning: `Classifier error: ${result.error || "unknown"}`,
            structure: {},
          });
        }
      }
    }

    // Merge workbook summaries across chunks: pick most common primary_pattern; OR clarification flags.
    const counts = new Map<string, number>();
    for (const s of summaries) {
      const k = String(s.primary_pattern || "unknown");
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    let primary = "mixed";
    let best = 0;
    for (const [k, v] of counts) {
      if (v > best) { primary = k; best = v; }
    }
    const needsClar = summaries.some(s => s.needs_user_clarification === true);
    const clarReason = summaries.find(s => s.clarification_reason)?.clarification_reason;

    // Merge clarification_type: pick first non-null; if multiple chunks disagree → "mixed_patterns".
    const clarTypes = summaries
      .map(s => s.clarification_type)
      .filter((t: unknown): t is string => typeof t === "string" && t.length > 0);
    const uniqueClarTypes = [...new Set(clarTypes)];
    let clarType: string | null = null;
    if (needsClar) {
      if (uniqueClarTypes.length === 0) clarType = "other";
      else if (uniqueClarTypes.length === 1) clarType = uniqueClarTypes[0];
      else clarType = "mixed_patterns";
    }

    // Merge parser_directives across chunks (union of arrays, OR of booleans).
    const excludeSheetsSet = new Set<string>();
    const excludePredsSet = new Set<string>();
    let includeOnlyRecent = false;
    for (const d of directivesList) {
      if (Array.isArray(d.exclude_sheets)) {
        for (const s of d.exclude_sheets) if (typeof s === "string" && s.trim()) excludeSheetsSet.add(s.trim());
      }
      if (Array.isArray(d.exclude_row_predicates)) {
        for (const p of d.exclude_row_predicates) if (typeof p === "string" && p.trim()) excludePredsSet.add(p.trim());
      }
      if (d.include_only_recent === true) includeOnlyRecent = true;
    }

    const merged = {
      workbook_summary: {
        primary_pattern: summaries.length === 1 ? summaries[0].primary_pattern : primary,
        needs_user_clarification: needsClar,
        ...(clarReason ? { clarification_reason: clarReason } : {}),
        ...(clarType ? { clarification_type: clarType } : {}),
      },
      parser_directives: {
        exclude_sheets: [...excludeSheetsSet],
        exclude_row_predicates: [...excludePredsSet],
        include_only_recent: includeOnlyRecent,
      },
      sheets: allSheets,
      model: MODEL,
      tokens: { input: totalIn, output: totalOut },
      duration_ms: totalDuration,
      classified_at: startedAt,
      chunks: chunks.length,
    };

    const { error: updErr } = await supabase
      .from("processing_sessions")
      .update({ layout_classification: merged, layout_classified_at: new Date().toISOString() })
      .eq("id", sessionId);
    if (updErr) console.error("[classify-layout] persist error:", updErr.message);

    return new Response(JSON.stringify({ success: true, data: merged }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[classify-layout] fatal:", e);
    if (sessionId) await persistSentinel(supabase, sessionId, e instanceof Error ? e.message : String(e));
    return new Response(JSON.stringify({ success: false, error: "Layout classification failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function persistSentinel(supabase: ReturnType<typeof createClient>, sessionId: string, error: string) {
  try {
    await supabase.from("processing_sessions").update({
      layout_classification: { error, model: MODEL, classified_at: new Date().toISOString() },
      layout_classified_at: new Date().toISOString(),
    }).eq("id", sessionId);
  } catch (e) {
    console.error("[classify-layout] sentinel persist failed:", e);
  }
}
