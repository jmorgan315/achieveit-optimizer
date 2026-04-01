

# Chunked Classification for 50+ Page Documents

## Overview
When a document has more than 50 pages, split page images into chunks of 25 and classify each chunk separately. Merge results into a single classification. Documents with 50 or fewer pages are unchanged.

## Changes — single file: `supabase/functions/classify-document/index.ts`

### 1. Add constant
```typescript
const CLASSIFICATION_CHUNK_SIZE = 25;
const CLASSIFICATION_CHUNK_THRESHOLD = 50;
```

### 2. Add helper: `buildImageContent`
Extract the existing image-processing loop (lines 277-296) into a reusable function that converts a slice of `pageImages` into Claude content blocks. Accepts `pageImages` array and `startIndex` (for correct page numbering in the prompt).

### 3. Add helper: `classifyChunk`
Takes a chunk of page images, the chunk index, page offset, API key, user prompt base, and session ID. Builds the request, calls `callAnthropicWithRetry` (the local one already in the file), parses the response, logs it. Returns the parsed classification or `null` on failure.

### 4. Add helper: `mergeClassifications`
Merges multiple chunk classification results into one:
- `page_annotations`: concatenate all, already correctly numbered since each chunk prompt specifies its page range
- `plan_content_pages`: union of all chunks
- `skip_pages`: union of all chunks
- `document_type`: majority vote across chunks, fallback to first chunk
- `confidence`: average across chunks
- `hierarchy_pattern`: take from the chunk with highest confidence (most likely has the richest content)
- `table_structure`: take first non-null
- `extraction_recommendations`: take from highest-confidence chunk
- `non_plan_content`: OR-merge all boolean fields, concat metadata_columns

### 5. Add helper: `buildFallbackAnnotationsForPages`
For failed chunks, generate conservative page_annotations with `contains_plan_items: true` and classification `"plan_content"` for each page in the failed range.

### 6. Modify main handler (lines 268-395)
After validation and session setup:

```
if (pageCount <= CLASSIFICATION_CHUNK_THRESHOLD) {
  // existing single-request path — no changes
} else {
  // chunked path:
  // 1. Split pageImages into chunks of CLASSIFICATION_CHUNK_SIZE
  // 2. Process each chunk sequentially (to avoid rate limits)
  //    - Add page range info to user prompt: "These are pages X-Y of Z total"
  //    - Call classifyChunk
  //    - On failure: log warning, add fallback annotations for those pages
  // 3. mergeClassifications on all results
  // 4. Log total chunks, succeeded/failed counts, total time
}
```

Each chunk's user prompt gets an additional line: `"Note: These are pages {start}-{end} of {total} total pages. Return page numbers using the original document numbering (starting from {start})."` — this ensures page indices are preserved.

### 7. Logging
- Log at start: `"[classify-document] Chunked classification: {N} chunks of {CHUNK_SIZE} for {pageCount} pages"`
- Log per chunk: success/failure, duration, tokens
- Log at end: `"[classify-document] Chunked classification complete: {succeeded}/{total} chunks succeeded in {totalMs}ms"`

### 8. Deploy
Deploy `classify-document` edge function.

## What does NOT change
- Classification prompt (CLASSIFICATION_SYSTEM_PROMPT)
- Model (`claude-opus-4-6`)
- Documents with ≤50 pages (existing single-request path)
- All other edge functions
- Frontend code

