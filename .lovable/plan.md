

## Fix: Preserve Page Identity Through the Pipeline

### Root Cause

When the frontend filters images by page range, it sends a flat array of 3 images (pages 61-63) to `process-plan`. The server has no way to know these are pages 61-63 — it treats them as pages 1, 2, 3. This causes three cascading problems:

1. **Server-side early filter is a no-op**: `parsePageRange("61-63", 3)` produces an empty set because pages 61-63 all exceed `maxPage=3`. The filter correctly does nothing (images are already filtered), but this is fragile.

2. **Agent 0 page_annotations mismatch**: The quick scan classified all 65 pages, so annotations reference original page numbers (1-65). When the annotation filter runs against 3 images, it checks `p <= images.length` (3), discarding annotations for pages 61-63. Instead, annotations for pages 1-3 might accidentally match — page 3's annotation ("plan content overview") passes, which refers to a completely different page than what's actually in the image array.

3. **Extraction prompt says "pages undefined through undefined"**: The page range start/end values aren't being passed to the extraction prompt builder, so the LLM gets no page-scoping instruction.

The first run (85 items, mostly correct) got lucky — the annotation filter happened to keep the right images, and the LLM extracted from what it saw. The second run (59 items) likely had different annotation matching or LLM behavior.

### Fix Strategy

Rather than sending page numbers alongside images (which would require changes to every downstream function), fix the two specific broken behaviors:

#### 1. Skip annotation-based page filtering when pageRange is set

In `process-plan/index.ts`, when the user specified a `pageRange`, the frontend already filtered the images. The annotation-based filter (lines 816-868) uses original page numbers that don't correspond to the filtered image indices. Skip it.

**File**: `supabase/functions/process-plan/index.ts` (~line 816)

**Current**:
```typescript
const pageAnnotationsArr = classification?.page_annotations as ...;
if (Array.isArray(pageAnnotationsArr) && pageAnnotationsArr.length > 0) {
```

**New**:
```typescript
const hasUserPageRange = typeof pageRange === "string" && (pageRange as string).trim();
const pageAnnotationsArr = classification?.page_annotations as ...;
if (!hasUserPageRange && Array.isArray(pageAnnotationsArr) && pageAnnotationsArr.length > 0) {
```

When `pageRange` is set, skip the annotation filter entirely — the images are already scoped by the frontend. Add a log line: `"[process-plan] Skipping annotation filter — images already scoped by pageRange"`.

#### 2. Pass page range to extraction prompt

In the extraction call builder (where the prompt includes "pages undefined through undefined"), replace the undefined start/end with the actual `pageRange` string.

**File**: `supabase/functions/process-plan/index.ts` (extraction prompt construction, ~line 930-960)

Find where the extraction prompt is built and ensure it uses `pageRange` correctly. The current code likely does something like:
```typescript
`pages ${startPage} through ${endPage}`
```
where `startPage`/`endPage` are derived from the (now-filtered) image array indices. Replace with the user's actual pageRange string when available:
```typescript
const scopeNote = hasUserPageRange
  ? `The user has indicated that the actionable plan content is on pages ${pageRange} of the original document. Focus your extraction ONLY on content from those pages.`
  : '';
```

#### 3. Remove the redundant server-side early filter

The early filter at lines 700-709 is now a permanent no-op (the frontend pre-filters, so `parsePageRange("61-63", 3)` always returns empty). Remove it to avoid confusion, and add a comment explaining that page filtering is done client-side.

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/process-plan/index.ts` | (1) Skip annotation filter when `pageRange` is set; (2) Fix extraction prompt to use actual page range; (3) Remove dead early filter code |

### What stays the same
- Frontend image filtering in `FileUploadStep.tsx` — working correctly
- `classify-document` — operates on all pages during quick scan, as intended
- `text_heavy` override guard — stays as-is
- `extract-plan-items` function — no changes needed

### Verification
After deploying, the extraction prompt should say "pages 61-63" instead of "pages undefined through undefined", and the annotation filter should be skipped for page-scoped runs.

