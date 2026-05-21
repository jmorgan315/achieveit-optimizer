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
- exclude_row_predicates: string[] — human-readable row filters from the user's notes. Empty by default.
    Preserve the user's phrasing when it's already a clear filter; do not over-canonicalize.
    Do NOT invent column qualifiers when the user's input doesn't specify a column.
    Do NOT join ambiguous columns with "/". Pick one column, or use the un-columned starts-with form.
    Accepted forms (use whichever fits the user's wording most naturally):
      • "rows starting with <text>"               — when user named no column
      • "rows where <Column> = <value>"            — equality on a named column
      • "rows where <Column> contains <text>"      — substring match on a named column
      • "rows where <Column> starts with <text>"   — prefix match on a named column
    If the user's note is more complex than these forms, leave it close to their original wording —
    the parser will mark it too-complex and the user can adjust manually.
- include_only_recent: boolean — true ONLY when the user explicitly asks for the latest/most-recent version ("just the latest", "current year only"). False by default. The classifier may still flag time-versioning structurally via clarification_type without setting this.
- cell_transformations: array — recognized cell-cleanup rules extracted from documentHints. Only emit entries that match these patterns; otherwise leave empty:
    * "take-first-delimited" when the user says to pick/take the first value when multiple are listed in a cell. Optionally include "delimiter" (default ";") and "level".
    * "resolve-numeric-reference" when the user says number-only cells should be resolved to the corresponding named entry in the same column ("if just a number, look up / match to named"). Optionally include "level".
  Do NOT invent rules outside these two patterns.

  RULES FOR THE "level" FIELD (critical — these prevent the most common classifier error):

  1. GROUNDING. The "level" value MUST be either:
       (a) empty/omitted (rule applies workbook-wide), OR
       (b) a case-insensitive match to one of the level names you put into some sheet's structure.implied_levels for this same response.
     NEVER write an arbitrary column header here. NEVER invent a level name. If the user's wording does not resolve to any implied_levels entry, leave "level" empty.

  2. SEMANTIC RESOLUTION — USER WORDING WINS. When documentHints references a level by name (e.g., "focus area", "objective", "tactic"), find the closest implied_levels entry across all sheets using stem-folded, case-insensitive, singular/plural-tolerant matching, and use the user's wording as the anchor:
       - If the user says "focus area" and any sheet's implied_levels contains "Focus Area", use "Focus Area" — even if you classified that same column on a different sheet as "Government Area", "Department Team", or any other label. The user's wording overrides your own level naming.
       - Your level naming is only a fallback for when the user did not name the level at all.
     If the user's term matches NO implied_levels entry on any sheet, leave "level" empty rather than substituting a near-miss header.

  3. ANTI-PATTERN GUARD — DO NOT GUESS FROM DATA SHAPE. The "level" field describes the user's intent, not the structural shape of the data. Do NOT pick a level (or column) just because that column happens to contain semicolon-delimited cells, numeric-only cells, or any other pattern that matches the rule. The data shape is irrelevant here; only the user's words in documentHints determine "level".

=== COLUMN HINTS (per sheet, optional) ===

For each sheet whose pattern is A, B, or C, OPTIONALLY emit a "column_hints" array describing non-structural attribute columns the downstream parser should consider mapping onto PlanItem fields. These are NOT the name/hierarchy columns — those are already captured by structure fields. Column hints surface columns like Owner / Assigned To, Due Date / Target Date, Status, Frequency, Measurement / KPI / Metric, Description / Notes, etc.

Each entry:
  - col_index: 0-based column index in the sheet's grid
  - suggested_attribute: short snake_case identifier for the attribute. Use one of the canonical names when applicable: "owner" | "due_date" | "status" | "frequency" | "measurement" | "description" | "start_date" | "priority". For columns that don't match a canonical attribute but still look like structured plan metadata, emit a descriptive snake_case label (e.g. "fiscal_year", "department").
  - confidence: one of the string literals "high" | "medium" | "low". Use "high" when the column header is unambiguous (e.g. "Owner", "Due Date"). Use "medium" when the header is suggestive but the data could fit multiple attributes. Use "low" when you're guessing from data shape with a weak header.
  - reason: short (≤120 chars) human-readable justification — what header text and/or data pattern drove the suggestion.

Omit column_hints entirely (or emit []) for sheets classified as not_plan_content, empty, unknown, or D. Never emit hints for the name/hierarchy columns already encoded in structure.name_column_index or structure.hierarchy_signal.

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
        cell_transformations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              rule: { type: "string", enum: ["take-first-delimited", "resolve-numeric-reference"] },
              level: {
                type: "string",
                description: "Empty, OR a case-insensitive match to one of this response's implied_levels entries. NEVER an arbitrary column header. When the user named a level in documentHints, prefer the user's wording (resolved against implied_levels) over your own level interpretation.",
              },
              delimiter: { type: "string" },
            },
            required: ["rule"],
          },
        },
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

    // Merge cell_transformations across chunks; union by (rule, level, delimiter).
    const cellTxByKey = new Map<string, { rule: string; level?: string; delimiter?: string }>();
    for (const d of directivesList) {
      const arr = (d as { cell_transformations?: unknown }).cell_transformations;
      if (!Array.isArray(arr)) continue;
      for (const t of arr) {
        if (!t || typeof t !== "object") continue;
        const rule = (t as { rule?: unknown }).rule;
        if (rule !== "take-first-delimited" && rule !== "resolve-numeric-reference") continue;
        const level = typeof (t as { level?: unknown }).level === "string"
          ? ((t as { level: string }).level).trim() || undefined
          : undefined;
        const delimiter = typeof (t as { delimiter?: unknown }).delimiter === "string"
          ? ((t as { delimiter: string }).delimiter) || undefined
          : undefined;
        const key = `${rule}|${level || "*"}|${delimiter || ""}`;
        if (!cellTxByKey.has(key)) cellTxByKey.set(key, { rule, level, delimiter });
      }
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
        cell_transformations: [...cellTxByKey.values()],
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
