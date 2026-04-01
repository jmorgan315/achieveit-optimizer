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

/** Retry wrapper for Anthropic API calls with exponential backoff */
export async function callAnthropicWithRetry(
  url: string,
  fetchOptions: RequestInit,
  maxRetries = 3,
  initialDelayMs = 2000,
): Promise<Response> {
  const RETRYABLE_STATUSES = new Set([429, 408, 529]);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, fetchOptions);
      if (response.ok || !RETRYABLE_STATUSES.has(response.status) || attempt === maxRetries) {
        return response;
      }
      const delay = initialDelayMs * Math.pow(2, attempt);
      console.warn(`[Retry] Attempt ${attempt + 1}/${maxRetries} failed with status ${response.status}. Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === maxRetries) throw lastError;
      const delay = initialDelayMs * Math.pow(2, attempt);
      console.warn(`[Retry] Attempt ${attempt + 1}/${maxRetries} network error: ${lastError.message}. Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError || new Error("Retry failed");
}
