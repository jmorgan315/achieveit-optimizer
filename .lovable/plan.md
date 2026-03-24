


# Per-Batch Persistence for Pipeline Resilience — IMPLEMENTED

## What was done

### 1. Created `page-images` storage bucket
Migration creates the bucket with public read + insert + delete policies for resume capability.

### 2. Per-batch persistence (`process-plan/index.ts`)
- **Image persistence**: After classification/page filtering, all filtered page images are uploaded to `page-images/{sessionId}/{idx}.jpg` before extraction begins
- **Incremental state saves**: After each extraction batch, the session row is updated with cumulative `items`, `batches_completed`, `batches_total`, `batch_pages`, and `total_filtered_images`
- **`current_step: "extracting"`** during batches, `"extraction_complete"` after dedup

### 3. Expanded resume logic
- **Path A (`extracting`, incomplete batches)**: Downloads images from storage, re-batches, continues from `batches_completed`, runs dedup → Agents 2+3
- **Path B (`extracting`, all batches done)**: Runs dedup → Agents 2+3 directly
- **Path C (`extraction_complete`)**: Existing behavior — runs Agents 2+3
- Extracted shared Agents 2+3 logic into `runPostExtractionResume()` helper

### 4. Frontend stall detection (`FileUploadStep.tsx`)
- Tracks `batches_completed` changes during `extracting` phase
- Fires resume after 30s stall (separate from existing 20s `extraction_complete` stall)
- Shows batch progress percentage during extraction
- Improved partial results fallback with batch-specific warning message

### 5. Cleanup
- Fire-and-forget deletion of stored page images after pipeline completes (both normal and resume paths)

## Files changed
| File | Change |
|------|--------|
| Migration (SQL) | Created `page-images` storage bucket |
| `supabase/functions/process-plan/index.ts` | Image persistence, per-batch saves, expanded resume, cleanup |
| `src/components/steps/FileUploadStep.tsx` | Extraction-phase stall detection, batch progress display |
