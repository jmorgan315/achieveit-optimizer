import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function getClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

export interface ApiCallLogEntry {
  session_id: string;
  edge_function: string;
  step_label?: string;
  model?: string;
  request_payload?: Record<string, unknown>;
  response_payload?: Record<string, unknown>;
  input_tokens?: number;
  output_tokens?: number;
  duration_ms?: number;
  status: "success" | "error" | "timeout";
  error_message?: string;
}

/** Fire-and-forget: insert a row into api_call_logs */
export async function logApiCall(entry: ApiCallLogEntry): Promise<void> {
  try {
    const client = getClient();
    console.log(`[Logging] Inserting api_call_log: session=${entry.session_id}, fn=${entry.edge_function}, step=${entry.step_label}`);
    const { error } = await client.from("api_call_logs").insert(entry);
    if (error) {
      console.error("[Logging] Failed to insert api_call_log:", {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        session_id: entry.session_id,
        edge_function: entry.edge_function,
        step_label: entry.step_label,
      });
    } else {
      console.log(`[Logging] api_call_log inserted OK: session=${entry.session_id}, step=${entry.step_label}`);
    }
  } catch (e) {
    console.error("[Logging] logApiCall exception:", e);
  }
}

export interface SessionData {
  id: string;
  org_name?: string;
  org_industry?: string;
  document_name?: string;
  document_size_bytes?: number;
  extraction_method?: string;
  status?: string;
}

/** Create a processing_sessions row. Returns the id. */
export async function createSession(data: SessionData): Promise<string> {
  try {
    const client = getClient();
    const { error } = await client.from("processing_sessions").insert({
      id: data.id,
      org_name: data.org_name,
      org_industry: data.org_industry,
      document_name: data.document_name,
      document_size_bytes: data.document_size_bytes,
      extraction_method: data.extraction_method,
      status: data.status || "in_progress",
    });
    if (error) console.error("[Logging] Failed to create session:", error.message);
  } catch (e) {
    console.error("[Logging] createSession exception:", e);
  }
  return data.id;
}

export interface SessionUpdate {
  total_items_extracted?: number;
  total_api_calls?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_duration_ms?: number;
  status?: string;
  extraction_method?: string;
}

/** Update an existing processing_sessions row */
export async function updateSession(sessionId: string, updates: SessionUpdate): Promise<void> {
  try {
    const client = getClient();
    const { error } = await client.from("processing_sessions").update(updates).eq("id", sessionId);
    if (error) console.error("[Logging] Failed to update session:", error.message);
  } catch (e) {
    console.error("[Logging] updateSession exception:", e);
  }
}

/** Ensure a session exists — upsert if needed. Returns sessionId. */
export async function ensureSession(sessionId: string | undefined): Promise<string> {
  const id = sessionId || crypto.randomUUID();
  try {
    const client = getClient();
    // Upsert: if the row already exists (created by frontend), this is a no-op.
    // If it doesn't exist (safety net), it gets created.
    const { error } = await client.from("processing_sessions").upsert(
      { id, status: "in_progress" },
      { onConflict: "id", ignoreDuplicates: true }
    );
    if (error) {
      console.error("[Logging] ensureSession upsert failed:", {
        error: error.message,
        code: error.code,
        details: error.details,
        sessionId: id,
      });
    } else {
      console.log(`[Logging] ensureSession OK: ${id} (provided=${!!sessionId})`);
    }
  } catch (e) {
    console.error("[Logging] ensureSession exception:", e);
  }
  return id;
}

/**
 * Extract token usage from various AI provider response formats.
 * Anthropic: usage.input_tokens / usage.output_tokens
 * OpenAI/Lovable: usage.prompt_tokens / usage.completion_tokens
 */
export function extractTokenUsage(response: Record<string, unknown>): { input_tokens?: number; output_tokens?: number } {
  const usage = response?.usage as Record<string, number> | undefined;
  if (!usage) return {};
  return {
    input_tokens: usage.input_tokens ?? usage.prompt_tokens,
    output_tokens: usage.output_tokens ?? usage.completion_tokens,
  };
}

// ─── Shared Anthropic retry utility ───
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 529]);
const BACKOFF_SCHEDULE_MS = [5_000, 15_000, 30_000]; // 3 retries

/**
 * Fetch wrapper for Anthropic API with exponential backoff.
 * Retries on 408, 429, 500, 502, 503, 529 up to 3 times (4 total attempts).
 * Respects `retry-after` header when present.
 */
export async function callAnthropicWithRetryShared(
  apiKey: string,
  body: Record<string, unknown>,
  context?: { functionName?: string; sessionId?: string }
): Promise<Response> {
  const label = context?.functionName || "anthropic-call";
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= BACKOFF_SCHEDULE_MS.length; attempt++) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.ok) return response;

    lastResponse = response;

    if (!RETRYABLE_STATUSES.has(response.status) || attempt >= BACKOFF_SCHEDULE_MS.length) {
      // Not retryable or exhausted retries — return as-is
      return response;
    }

    // Determine wait time: prefer retry-after header, else use schedule
    const retryAfterHeader = response.headers.get("retry-after");
    let waitMs = BACKOFF_SCHEDULE_MS[attempt];
    if (retryAfterHeader) {
      const parsed = parseInt(retryAfterHeader, 10);
      if (!isNaN(parsed)) waitMs = Math.max(parsed * 1000, waitMs);
    }

    console.warn(
      `[${label}] Retryable status ${response.status}, attempt ${attempt + 1}/${BACKOFF_SCHEDULE_MS.length}, waiting ${waitMs}ms` +
      (context?.sessionId ? ` (session=${context.sessionId})` : "")
    );
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  return lastResponse!;
}

/** Truncate image data from a request payload for logging (replace base64 with metadata) */
export function truncateImagePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(payload));
  const messages = clone.messages as Array<{ content?: unknown }> | undefined;
  if (!messages) return clone;

  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      msg.content = msg.content.map((block: Record<string, unknown>) => {
        if (block.type === "image" && block.source) {
          const source = block.source as Record<string, string>;
          return {
            type: "image",
            source: {
              type: source.type,
              media_type: source.media_type,
              data: `[BASE64_TRUNCATED: ${(source.data?.length || 0)} chars]`,
            },
          };
        }
        return block;
      });
    }
  }
  return clone;
}
