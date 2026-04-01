

# Use text extraction for text_heavy documents

## Summary

After Agent 0 classifies a document as `text_heavy`, the `process-plan` orchestrator will switch from vision extraction (`extract-plan-vision` with page images) to text extraction (`extract-plan-items` with documentText chunks). This avoids sending expensive page images to Opus when clean selectable text is available.

## Current behavior

- Line 634: `useVision` is set based on whether `pageImages` exist in the request
- Line 692: If `useVision` is true, vision extraction runs regardless of Agent 0's classification
- Agent 0's `document_type` is saved to the session (line 671-674) but never influences the extraction path
- Text extraction only runs if no pageImages were sent, or as a fallback when vision returns 0 items (line 886)

## Changes

### File: `supabase/functions/process-plan/index.ts`

**Change 1: After Agent 0 classification, override to text extraction for text_heavy documents**

After the classification block (around line 681), add logic:

```
if classification.document_type === "text_heavy"
  AND documentText is available (non-empty, >50 chars):
    → set useVision = false (let it variable, not const)
    → set extractionMethod = "text"
    → log: "[process-plan] Document classified as text_heavy — using text extraction instead of vision"
```

This requires changing `useVision` from `const` to `let` (line 634).

**Change 2: Add per-batch text extraction with persistence in the vision=false path**

Currently the text-only path (lines 922-938) calls `extract-plan-items` as a single edge function call which handles its own chunking internally. This won't work for large documents because:
- The edge function itself has a 150s timeout
- No per-batch persistence means resume can't pick up mid-extraction

Replace the simple single-call text path with a batched approach that mirrors the vision path:
1. Split `documentText` into chunks using the same `splitDocumentIntoChunks` function (import from extract-plan-items or duplicate the logic — it splits on paragraph boundaries at ~25K chars)
2. For each chunk, call `extract-plan-items` with just that chunk (the edge function already supports single chunks)
3. After each chunk completes, persist results to the session with `batches_completed`, `batches_total`, same structure as vision batches
4. Include ownership check before each batch
5. Store `extractionMode: "text"` in `pipelineContext` so resume knows to continue with text

**Change 3: Update resume logic to handle text extraction batches**

In `runResume` (line 1268), the mid-extraction resume path (line 1297) currently assumes vision extraction — it downloads page images from storage and calls `extract-plan-vision`.

Add a check: if `pipelineContext.extractionMethod === "text"`:
- Don't download page images
- Get `documentText` from `pipelineContext.documentText` (already persisted there, line 854)
- Re-chunk the text and continue from `batchesCompleted`
- Call `extract-plan-items` for remaining chunks
- Same per-batch persistence pattern

**Change 4: Skip page image persistence for text_heavy documents**

When `useVision` is overridden to false after classification, skip the `persistPageImages` call (line 757) since images won't be needed.

### Method tracking

When text extraction is used due to Agent 0 classification, `extractionMethod` is set to `"text"` (not `"text_fallback"`). This is already written to `processing_sessions.extraction_method` at line 1243.

### What stays the same

- Agent 0 classification logic — unchanged
- Frontend routing — unchanged (backend overrides based on classification)
- `extract-plan-items` edge function — used as-is, called per-chunk
- Agent 2, Agent 3, dedup, confidence scoring — all unchanged, they work on extracted items regardless of method
- Prompts and model selections — unchanged
- Presentation/tabular documents — still use vision extraction

## Technical details

The text chunking function (`splitDocumentIntoChunks`) from `extract-plan-items` splits at paragraph boundaries (~25K chars per chunk). We'll duplicate this small utility into `process-plan` rather than importing across function boundaries.

The `extract-plan-items` edge function already supports receiving a single chunk as `documentText` — it will just create one internal chunk and process it. We call it once per chunk from `process-plan`, giving us per-batch persistence between calls.

Batch persistence format matches vision exactly:
```json
{
  "extraction": {
    "items": [...],
    "detectedLevels": [...],
    "batches_completed": 3,
    "batches_total": 5,
    "completed_at": null
  },
  "pipelineContext": {
    "extractionMethod": "text",
    "documentText": "...",
    ...
  }
}
```

