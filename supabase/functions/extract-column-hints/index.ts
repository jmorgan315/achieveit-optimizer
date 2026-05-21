import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  logApiCall,
  extractTokenUsage,
  callAnthropicWithRetry,
} from "../_shared/logging.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MODEL = "claude-sonnet-4-6";
const SHEET_CHUNK = 2;          // chunks beyond threshold
const SHEET_CHUNK_THRESHOLD = 6; // ≤ this many sheets → one call
const MAX_SAMPLES = 8;
const PER_CHUNK_TIMEOUT_MS = 30_000;

// Locked enum — final list for 4c.2a + Stage B. No substitutions.
const ATTRIBUTE_ROLES = [
  "description",
  "status",
  "start_date",
  "due_date",
  "assigned_to",
  "members",
  "administrators",
  "update_frequency",
  "metric_description",
  "metric_unit",
  "metric_rollup",
  "metric_baseline",
  "metric_target",
  "current_value",
  "tags",
] as const;
type AttributeRole = (typeof ATTRIBUTE_ROLES)[number];

const CONFIDENCE_VALUES = ["high", "medium", "low"] as const;
type Confidence = (typeof CONFIDENCE_VALUES)[number];

const SYSTEM_PROMPT = `You are mapping spreadsheet columns from a strategic-plan workbook to AchieveIt's import-template attributes so a downstream parser knows what each non-structural column means.

Inputs you receive per sheet:
- sheet_name
- column_previews: for each non-structural column, its header (may be null) and up to 8 sample values

Structural columns (hierarchy / primary item name) are filtered out before you see them. Do NOT try to reconstruct hierarchy.

For each column, choose at most one role from the locked enum below, or null when no role applies. Pick the SINGLE best fit. Do not invent or rename roles.

=== ATTRIBUTE ROLE ENUM (locked — exact strings) ===

- description           — long-form prose explaining what the item is or why it exists. Sentences, not short labels.
- status                — execution state: "Not Started", "In Progress", "Complete", "On Hold", "At Risk", "%" complete, RYG, etc.
- start_date            — when work begins. Dates, quarters, fiscal periods used as start.
- due_date              — target completion date / deadline. "End date", "target", "by".
- assigned_to           — single owner / accountable individual. Person name or email, one per cell typically.
- members               — team members / collaborators / participants (multiple people contributing, not the single owner).
- administrators        — admins / approvers / executive sponsors / oversight roles.
- update_frequency      — cadence of reporting/review: "Monthly", "Quarterly", "Weekly", "Annual".
- metric_description    — description of WHAT is being measured (the KPI name or definition). Free-text describing the measurement.
- metric_unit           — unit of measure: "%", "$", "count", "hours", "FTE", "days".
- metric_rollup         — aggregation method: "sum", "average", "max", "latest", "min".
- metric_baseline       — starting value at the beginning of the period.
- metric_target         — goal value to reach.
- current_value         — most recent actual value / progress reading.
- tags                  — categorical labels, themes, pillars, tag lists. Often comma- or semicolon-delimited.

=== RULES ===

1. One role per column, or null. Never two.
2. If the header is generic ("Notes", "Comments", "Other") and samples are short labels, prefer null over forcing a role.
3. Confidence:
     high   — header AND samples both strongly indicate the role
     medium — header OR samples indicate it, the other is ambiguous
     low    — weak signal; you're guessing more than inferring
4. Reason must be ≤ 140 characters, plain English, no markdown.
5. Distinguish carefully:
     - assigned_to (one person) vs members (multiple) vs administrators (oversight)
     - metric_description (what is measured) vs description (item narrative)
     - start_date vs due_date (look at header wording and sample value placement)
6. Date-shaped values without a header hint → due_date if it's the only date column, else use header wording.

Respond ONLY via the report_column_hints tool.`;

const toolSchema = {
  type: "object",
  properties: {
    sheets: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sheet_name: { type: "string" },
          hints: {
            type: "array",
            items: {
              type: "object",
              properties: {
                column_index: { type: "number" },
                header: { type: ["string", "null"] },
                suggested_attribute: {
                  type: ["string", "null"],
                  enum: [...ATTRIBUTE_ROLES, null],
                },
                confidence: { type: "string", enum: [...CONFIDENCE_VALUES] },
                reason: { type: "string" },
              },
              required: [
                "column_index",
                "suggested_attribute",
                "confidence",
                "reason",
              ],
            },
          },
        },
        required: ["sheet_name", "hints"],
      },
    },
  },
  required: ["sheets"],
};

interface ColumnPreview {
  column_index: number;
  header: string | null;
  sample_values: string[];
}

interface InputSheet {
  sheet_name: string;
  header_row_index: number | null;
  hierarchy_columns: number[];
  name_column_index: number | null;
  column_previews: ColumnPreview[];
}

interface SheetHints {
  sheet_name: string;
  hints: Array<{
    column_index: number;
    header: string | null;
    suggested_attribute: AttributeRole | null;
    confidence: Confidence;
    reason: string;
  }>;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildUserMessage(sheets: InputSheet[]): string {
  const blocks = sheets.map((s) => {
    const rows = s.column_previews
      .map((c) => {
        const samples = c.sample_values.slice(0, MAX_SAMPLES).join(" | ");
        return `  col ${c.column_index}: header=${
          c.header === null ? "(none)" : JSON.stringify(c.header)
        }  samples=[${samples}]`;
      })
      .join("\n");
    return `--- SHEET: ${s.sheet_name} ---\n${rows || "(no non-structural columns)"}\n`;
  });
  return `Classify the non-structural columns below. Structural columns (hierarchy / primary name) have already been stripped.\n\n${blocks.join(
    "\n",
  )}`;
}

async function callClaude(
  apiKey: string,
  userMessage: string,
): Promise<{
  ok: boolean;
  data?: { sheets: SheetHints[] };
  tokens: { input_tokens?: number; output_tokens?: number };
  durationMs: number;
  error?: string;
  raw?: unknown;
}> {
  const startTime = Date.now();
  const body = {
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    tools: [
      {
        name: "report_column_hints",
        description:
          "Report suggested AchieveIt attribute role for each non-structural column",
        input_schema: toolSchema,
      },
    ],
    tool_choice: { type: "tool", name: "report_column_hints" },
  };

  try {
    const resp = await callAnthropicWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    const durationMs = Date.now() - startTime;
    if (!resp.ok) {
      const errText = await resp.text();
      return {
        ok: false,
        tokens: {},
        durationMs,
        error: `Anthropic ${resp.status}: ${errText.slice(0, 500)}`,
      };
    }
    const json = await resp.json();
    const tokens = extractTokenUsage(json);
    const toolUse = json.content?.find(
      (b: { type: string }) => b.type === "tool_use",
    );
    if (!toolUse) {
      return {
        ok: false,
        tokens,
        durationMs,
        raw: json,
        error: "No tool_use in response",
      };
    }
    return { ok: true, data: toolUse.input, tokens, durationMs, raw: json };
  } catch (e) {
    return {
      ok: false,
      tokens: {},
      durationMs: Date.now() - startTime,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function sanitizeHints(
  inputSheets: InputSheet[],
  modelOutput: { sheets?: SheetHints[] } | undefined,
): SheetHints[] {
  const inputBy = new Map<string, InputSheet>();
  for (const s of inputSheets) inputBy.set(s.sheet_name, s);

  const out: SheetHints[] = [];
  for (const ms of modelOutput?.sheets ?? []) {
    const src = inputBy.get(ms.sheet_name);
    if (!src) continue;
    const validCols = new Set(src.column_previews.map((c) => c.column_index));
    const headerByCol = new Map(
      src.column_previews.map((c) => [c.column_index, c.header]),
    );

    const hints = (ms.hints ?? [])
      .filter(
        (h) =>
          typeof h.column_index === "number" && validCols.has(h.column_index),
      )
      .map((h) => {
        const attr =
          h.suggested_attribute &&
          (ATTRIBUTE_ROLES as readonly string[]).includes(
            h.suggested_attribute,
          )
            ? (h.suggested_attribute as AttributeRole)
            : null;
        const conf =
          h.confidence &&
          (CONFIDENCE_VALUES as readonly string[]).includes(h.confidence)
            ? (h.confidence as Confidence)
            : "low";
        return {
          column_index: h.column_index,
          header: headerByCol.get(h.column_index) ?? h.header ?? null,
          suggested_attribute: attr,
          confidence: conf,
          reason: typeof h.reason === "string" ? h.reason.slice(0, 280) : "",
        };
      });
    out.push({ sheet_name: ms.sheet_name, hints });
  }
  return out;
}

async function logDiagnostic(
  client: ReturnType<typeof createClient>,
  sessionId: string,
  log_type: string,
  sheet_name: string | null,
  payload: Record<string, unknown>,
) {
  try {
    await client.from("parser_diagnostics").insert({
      session_id: sessionId,
      parser_name: "extract-column-hints",
      log_type,
      sheet_name,
      payload,
    });
  } catch (e) {
    console.error("[extract-column-hints] diag insert failed:", e);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const overallStart = Date.now();
  let sessionId = "";
  let persist = true;

  try {
    const body = await req.json();
    sessionId = body?.sessionId;
    persist = body?.persist !== false;
    const sheets: InputSheet[] = Array.isArray(body?.sheets) ? body.sheets : [];

    if (!sessionId || sheets.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "sessionId and non-empty sheets[] required",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Service configuration error" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Chunking
    const chunkSize =
      sheets.length <= SHEET_CHUNK_THRESHOLD ? sheets.length : SHEET_CHUNK;
    const chunks = chunk(sheets, chunkSize);

    const allHints: SheetHints[] = [];
    let totalIn = 0;
    let totalOut = 0;
    let chunkErrors = 0;

    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const userMsg = buildUserMessage(c);
      try {
        const result = await withTimeout(
          callClaude(apiKey, userMsg),
          PER_CHUNK_TIMEOUT_MS,
          `chunk ${i + 1}/${chunks.length}`,
        );

        await logApiCall({
          session_id: sessionId,
          edge_function: "extract-column-hints",
          step_label: `chunk ${i + 1}/${chunks.length}`,
          model: MODEL,
          request_payload: {
            sheet_names: c.map((s) => s.sheet_name),
            column_count: c.reduce(
              (n, s) => n + s.column_previews.length,
              0,
            ),
          },
          response_payload: { ok: result.ok, error: result.error },
          input_tokens: result.tokens.input_tokens,
          output_tokens: result.tokens.output_tokens,
          duration_ms: result.durationMs,
          status: result.ok ? "success" : "error",
          error_message: result.error,
        });

        totalIn += result.tokens.input_tokens ?? 0;
        totalOut += result.tokens.output_tokens ?? 0;

        if (!result.ok) {
          chunkErrors++;
          await logDiagnostic(admin, sessionId, "hint", null, {
            status: "error",
            chunk_index: i,
            sheet_names: c.map((s) => s.sheet_name),
            error: result.error,
          });
          continue;
        }

        const cleaned = sanitizeHints(c, result.data);
        allHints.push(...cleaned);

        // Per-hint diagnostics
        for (const sh of cleaned) {
          for (const h of sh.hints) {
            await logDiagnostic(admin, sessionId, "hint", sh.sheet_name, h);
          }
        }
      } catch (e) {
        chunkErrors++;
        const err = e instanceof Error ? e.message : String(e);
        console.error("[extract-column-hints] chunk failed:", err);
        await logDiagnostic(admin, sessionId, "hint", null, {
          status: "error",
          chunk_index: i,
          sheet_names: c.map((s) => s.sheet_name),
          error: err,
        });
      }
    }

    // Summary diagnostic
    const byConfidence = { high: 0, medium: 0, low: 0 };
    let nullCount = 0;
    for (const sh of allHints) {
      for (const h of sh.hints) {
        byConfidence[h.confidence]++;
        if (h.suggested_attribute === null) nullCount++;
      }
    }

    await logDiagnostic(admin, sessionId, "extraction", null, {
      sheets_in: sheets.length,
      sheets_out: allHints.length,
      chunks_total: chunks.length,
      chunks_failed: chunkErrors,
      hints_total: allHints.reduce((n, s) => n + s.hints.length, 0),
      hints_null: nullCount,
      by_confidence: byConfidence,
      input_tokens: totalIn,
      output_tokens: totalOut,
      duration_ms: Date.now() - overallStart,
    });

    const result = { column_hints: allHints };

    if (persist) {
      const { error: updErr } = await admin
        .from("processing_sessions")
        .update({ column_hints: result })
        .eq("id", sessionId);
      if (updErr) {
        console.error(
          "[extract-column-hints] persist failed:",
          updErr.message,
        );
      }
    }

    return new Response(JSON.stringify({ success: true, data: result }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[extract-column-hints] fatal:", msg);
    return new Response(
      JSON.stringify({ success: false, error: "extract-column-hints failed" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
