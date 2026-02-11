

# Fix: Large Document Extraction Truncation

## Problem

The uploaded RHT document has 50 states, each with 1-2 pages of content. The text extraction worked fine (171,376 characters), but the AI model hit its **output token limit** before finishing all 50 states. It extracted Alabama through Georgia (10 states) and stopped. The edge function made a single API call with the entire document, and the structured JSON response for all 50 states exceeds what the model can output in one response.

## Solution: Chunked Text Extraction

Split large documents into chunks and process each chunk with a separate AI call, then merge the results -- similar to how Vision AI already works with batched page images.

### Change 1: Add Document Chunking to Edge Function
**File**: `supabase/functions/extract-plan-items/index.ts`

- Add a `splitDocumentIntoChunks` function that splits the document text into chunks of ~50,000 characters, breaking at paragraph/section boundaries (double newlines)
- For documents under 50,000 characters: process in a single call (current behavior)
- For larger documents: process each chunk separately, passing a `previousContext` summary so the AI maintains continuity (detected levels, what states were already covered, etc.)
- Merge results from all chunks: concatenate top-level items, use detected levels from the first chunk
- Set `max_tokens: 16384` on each API call to ensure the model has enough output room per chunk

### Change 2: Add Chunk Processing Loop
**File**: `supabase/functions/extract-plan-items/index.ts`

- Wrap the existing single API call in a loop over chunks
- For the first chunk, use the current system prompt as-is
- For subsequent chunks, append context: "Continue extracting from where the previous batch left off. Previously detected levels: [levels]. Previously extracted top-level items: [names list]. Do NOT re-extract items already covered."
- Merge items arrays from each chunk response
- Return combined results with the detected levels from the first successful chunk

### Change 3: Update Client-Side Progress
**File**: `src/components/steps/FileUploadStep.tsx`

- Update the `extractPlanItemsWithAI` function to show progress if the response includes chunk info (optional -- the chunking is server-side and transparent to the client, but we can show "Processing large document..." status)

## Technical Details

```text
Document Flow (Large Files):

  171,376 chars input
       |
  Split into chunks (~50K chars each)
       |
  Chunk 1 (Alabama - Kansas)   --> AI call --> 15 states extracted
  Chunk 2 (Kentucky - Nevada)  --> AI call --> 15 states extracted  
  Chunk 3 (New Hampshire - TX) --> AI call --> 15 states extracted
  Chunk 4 (Utah - Wyoming)     --> AI call --> 5 states extracted
       |
  Merge all items + use first chunk's detectedLevels
       |
  Return 50 states total
```

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/extract-plan-items/index.ts` | Add chunk splitting, loop over chunks with context passing, merge results, set max_tokens |
| `src/components/steps/FileUploadStep.tsx` | Minor: update status message for large documents |

## Edge Cases Handled

- Documents under 50K chars: no change, single call as before
- Chunk boundaries: split at paragraph breaks (double newlines) to avoid cutting mid-sentence
- Deduplication: pass previously extracted item names to subsequent chunks to prevent duplicates
- Detected levels consistency: use levels from the first chunk for all subsequent chunks
- Timeout safety: each chunk call is independent, so individual calls stay well within the edge function timeout

