

# Fix: Complete API Call Logging and Session Tracking

## Problem Analysis

After reviewing all edge functions and frontend code, here's the actual state:

**Edge function logging is already implemented** in `extract-plan-items` (chunk + verification), `extract-plan-vision` (with image truncation), `suggest-metrics`, and `lookup-organization`. The network logs confirm these are producing `api_call_logs` rows.

**What's actually broken/missing:**

1. **`parse-pdf`** — Has zero logging. User wants a row even though it's not an AI call.
2. **`processing_sessions` rows are never updated** — The frontend creates a `sessionId` and edge functions call `ensureSession()` which creates a bare row (no org info, no document info). But nobody ever updates the row with `org_name`, `org_industry`, `document_name`, `extraction_method`, `total_items_extracted`, aggregate tokens, or `status`. That's why admin shows "Unknown Org", "Items: —", "API Calls: 0", etc.

## Plan

### 1. Add logging to `parse-pdf` edge function

- Import `logApiCall`, `ensureSession` from shared logging
- Accept `sessionId` parameter
- Log a single row with `model: 'none'`, `edge_function: 'parse-pdf'`, `step_label: 'PDF Text Extraction'`
- `request_payload`: `{ filename: ..., fileSize: ... }`
- `response_payload`: `{ textLength: ..., pageCount: ... }`
- Return `sessionId` in response

### 2. Frontend: Update `processing_sessions` throughout wizard flow

The core fix — add Supabase client calls in the frontend to update the session row at each stage:

**In `OrgProfileStep`** (or `Index.tsx` after org confirmation):
- After user confirms org profile, update session row: `org_name`, `org_industry`

**In `FileUploadStep`**:
- When file is uploaded, update session: `document_name`, `document_size_bytes`
- After extraction completes (text or vision), update session: `extraction_method` ('text' or 'vision'), `total_items_extracted`, `status: 'completed'`
- On extraction failure, update: `status: 'failed'`
- After extraction, query `api_call_logs` for this session to aggregate `total_api_calls`, `total_input_tokens`, `total_output_tokens`, `total_duration_ms` and update the session row

**In `FileUploadStep.parsePdfWithEdgeFunction()`**:
- Pass `sessionId` to the `parse-pdf` edge function call

### 3. Files to modify

| File | Change |
|------|--------|
| `supabase/functions/parse-pdf/index.ts` | Add logging imports, accept `sessionId`, log the parse call |
| `src/components/steps/FileUploadStep.tsx` | Update session with document info, extraction method, totals, status after extraction |
| `src/pages/Index.tsx` | Update session with org details after org profile confirmation |

No database schema changes needed — tables already have all the right columns.

