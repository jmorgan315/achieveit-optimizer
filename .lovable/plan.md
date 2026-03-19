

# Create `classify-document` Edge Function

## Overview
New edge function that classifies a document's structure before extraction, using Claude vision with the provided system prompt. Returns a structured JSON classification to guide downstream agents.

## File: `supabase/functions/classify-document/index.ts`

### Structure
- Same CORS headers, retry logic, and error handling patterns as `extract-plan-vision`
- Reuse `callAnthropicWithRetry` (copied inline since edge functions can't share non-`_shared` code, or import from `_shared`)
- Import `logApiCall`, `ensureSession`, `extractTokenUsage`, `truncateImagePayload` from `../_shared/logging.ts`

### Input parsing
- Extract `pageImages`, `orgName`, `industry`, `userPlanLevels`, `pageRange`, `additionalNotes`, `sessionId` from request body
- Validate `pageImages` is non-empty array, each image is a string under 5MB

### Claude API call
- Model: `claude-sonnet-4-20250514` (same as vision extraction)
- `max_tokens: 4096`
- System prompt: the full classification prompt from the user's spec (verbatim)
- User message: multipart content with dynamic text prompt + all page images as Anthropic `image` blocks
- No tool_use — raw JSON response expected (the system prompt says "return ONLY a JSON object")

### User prompt construction
```
Classify this document for strategic plan extraction.

Organization: {orgName}
Industry: {industry}
[User-specified plan levels: Level 1: X, Level 2: Y, ...]
[User-specified page range: {pageRange}]
[Additional context: {additionalNotes}]

Analyze all provided page images and return ONLY the JSON classification object.
```

### Response parsing
- Strip markdown fencing if present (`json ... `)
- `JSON.parse` the response text
- On parse failure: log raw response, return default fallback classification:
  - `document_type: "text_heavy"`
  - `plan_content_pages`: all page numbers (1..N)
  - `primary_method: "vision"`
  - All pages annotated as `plan_content`

### Logging
- Log to `api_call_logs` with:
  - `step_label: "Step 0: Document Classification"`
  - `edge_function: "classify-document"`
  - Full request payload (images truncated via `truncateImagePayload`)
  - Full response payload
  - Token usage, duration, status

### Error handling
- Missing API key → 500
- Invalid input → 400
- Claude API errors → retry with backoff, then return fallback classification (not an error response)

## Config: `supabase/config.toml`
Add:
```toml
[functions.classify-document]
verify_jwt = false
```

## Files

| File | Action |
|------|--------|
| `supabase/functions/classify-document/index.ts` | Create — full edge function |
| `supabase/config.toml` | Add function entry (auto-managed, but noting for completeness) |

