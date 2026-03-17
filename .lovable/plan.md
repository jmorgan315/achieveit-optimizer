

# Plan: Add API Call Logging Database Layer

## Overview
Add two database tables (`processing_sessions`, `api_call_logs`) and instrument all edge functions to log every AI API call with full payloads, token counts, and timing. Frontend generates a `sessionId` and passes it through the flow.

## Step 1: Database Migration

Create tables via migration:

**`processing_sessions`** — one row per wizard run
- Columns as specified (id, created_at, org_name, org_industry, document_name, document_size_bytes, extraction_method, total_items_extracted, total_api_calls, total_input_tokens, total_output_tokens, total_duration_ms, status)

**`api_call_logs`** — one row per AI API call
- Columns as specified (id, created_at, session_id FK → processing_sessions, edge_function, step_label, model, request_payload, response_payload, input_tokens, output_tokens, duration_ms, status, error_message)

**RLS**: Enable on both tables with permissive `USING (true)` policies for all operations (anon + authenticated).

## Step 2: Create Shared Logging Helper

Create `supabase/functions/_shared/logging.ts` with a `logApiCall()` function that:
- Creates a Supabase client using `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
- Inserts into `api_call_logs` with all fields
- Is fire-and-forget (errors logged but don't break the main flow)
- Also exports `createSession()` and `updateSession()` helpers for `processing_sessions`

## Step 3: Instrument Edge Functions

### `extract-plan-items/index.ts`
- Accept optional `sessionId` in request body
- In `processChunk()`: wrap `callAnthropicWithRetry` with timing + log call with step_label like `"Chunk 1/3 Extraction"`
- In `runVerificationPass()`: wrap with timing + log with step_label `"Chunk 1/3 Verification"`
- Return `sessionId` in response

### `extract-plan-vision/index.ts`
- Accept optional `sessionId` in request body
- Wrap the `callAnthropicWithRetry` call with timing + log with step_label like `"Vision Batch 1 (pages 1-5)"`
- Return `sessionId` in response

### `suggest-metrics/index.ts`
- Accept optional `sessionId` in request body
- Wrap the Anthropic fetch with timing + log with step_label `"Metric Suggestion"`
- Return `sessionId` in response

### `lookup-organization/index.ts`
- Accept optional `sessionId` in request body
- Wrap the Lovable AI fetch with timing + log with step_label `"Organization Lookup"`
- Return `sessionId` in response

**What gets logged in `request_payload`**: The full body sent to the AI API (system prompt, user messages, tools config, model). For vision, image data will be truncated to avoid huge payloads (store image count + sizes instead of full base64).

**What gets logged in `response_payload`**: The full AI response JSON. Token counts extracted from `usage.input_tokens` / `usage.output_tokens` (Anthropic) or `usage.prompt_tokens` / `usage.completion_tokens` (OpenAI/Lovable AI).

## Step 4: Frontend Session Tracking

### `src/types/plan.ts`
- Add `sessionId?: string` to `PlanState`

### `src/hooks/usePlanState.ts`
- Add `setSessionId` callback
- Expose `sessionId` in state

### `src/components/steps/FileUploadStep.tsx`
- Generate `sessionId` (via `crypto.randomUUID()`) when processing starts
- Pass `sessionId` to all edge function calls (`extract-plan-items`, `extract-plan-vision`)
- After extraction completes, insert/update `processing_sessions` row via direct Supabase client call with aggregate stats

### `src/components/steps/OrgProfileStep.tsx`
- Pass `sessionId` to `lookup-organization` calls

### `src/components/plan-optimizer/EditItemDialog.tsx` (or wherever suggest-metrics is called)
- Pass `sessionId` to `suggest-metrics` calls

### `src/pages/Index.tsx`
- Generate the `sessionId` at the top level when the user enters the Upload step
- Thread it down through props to FileUploadStep and PlanOptimizerStep

## Technical Notes

- **Image payload truncation**: For vision calls, `request_payload` will store image metadata (count, sizes) rather than full base64 to keep rows manageable. The actual images are ephemeral.
- **Service role key**: The logging helper uses `SUPABASE_SERVICE_ROLE_KEY` (already available) to bypass RLS from edge functions.
- **Non-blocking**: All logging is async/fire-and-forget so it never slows down the main extraction flow.
- **5 files modified** (4 edge functions + shared helper), **3-4 frontend files** modified, **1 migration**.

