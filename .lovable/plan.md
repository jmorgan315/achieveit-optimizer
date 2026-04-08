

## Fix: Page Range Enforcement End-to-End

### Root Causes

1. **`process-plan`**: Has `parsePageRange()` but never calls it. Page images go through Agent 0's `page_annotations` filter but never the user's explicit page range.
2. **`text_heavy` override**: When `text_heavy` is detected, the pipeline switches from vision to text extraction (line 768), sending full document text with no page filtering. Since `parse-pdf` returns full-document text without page boundaries, the only fix is to force vision extraction when `pageRange` is set.
3. **`extract-plan-items`**: The `processChunk` function signature expects `pageRange` as `{ startPage: number; endPage: number }` (line 407), but the frontend now sends a string like `"61-63"`. The prompt generation at line 420-422 tries to read `.startPage` and `.endPage` which are undefined on a string.

### Fix Plan

#### 1. `supabase/functions/process-plan/index.ts` — Server-side image filtering

After Agent 0's `page_annotations` filtering (around line 838), add a second filter using `parsePageRange()` to enforce the user's explicit page range:

```typescript
// After the page_annotations filtering block, before persistPageImages:
if (typeof pageRange === "string" && pageRange.trim()) {
  const allowedPages = parsePageRange(pageRange as string, images.length);
  if (allowedPages.size > 0) {
    const beforeCount = images.length;
    // Note: at this point images may already be filtered by page_annotations,
    // but we need original page numbers. Track them.
    // Since page_annotations filter already re-indexed, we need to apply
    // pageRange BEFORE page_annotations or track original indices.
  }
}
```

**Better approach**: Apply `parsePageRange` filtering *before* the `page_annotations` filter, right after `let images = pageImages as string[]` (line 788). This way we first scope to user's pages, then let Agent 0 further refine within that subset.

Insert at line ~789:
```typescript
// Apply user-specified page range FIRST (safety net)
if (typeof pageRange === "string" && (pageRange as string).trim()) {
  const maxPage = images.length;
  const allowedPages = parsePageRange(pageRange as string, maxPage);
  if (allowedPages.size > 0) {
    const beforeCount = images.length;
    images = images.filter((_, idx) => allowedPages.has(idx + 1));
    console.log(`[process-plan] pageRange "${pageRange}" filter: ${beforeCount} → ${images.length} images`);
  }
}
```

#### 2. `supabase/functions/process-plan/index.ts` — Force vision when pageRange + text_heavy

Change the `text_heavy` override block (lines 768-779). When `pageRange` is set AND images are available, do NOT switch to text — keep vision with filtered images:

```typescript
if (useVision && classification?.document_type === "text_heavy" && hasDocumentText) {
  if (typeof pageRange === "string" && (pageRange as string).trim()) {
    // pageRange is set — keep vision extraction with filtered images
    // (text path has no page boundaries, so vision is the only way to enforce page scoping)
    console.log("[process-plan] text_heavy but pageRange set — keeping vision extraction for page-scoped accuracy");
  } else {
    console.log("[process-plan] Document classified as text_heavy — using text extraction instead of vision");
    useVision = false;
    extractionMethod = "text";
    // ... existing logApiCall
  }
}
```

#### 3. `supabase/functions/extract-plan-items/index.ts` — Normalize pageRange type

Change line 407 signature and lines 420-422 to handle string format:

In `processChunk` signature (line 407), change `pageRange` type:
```typescript
pageRange?: string | { startPage: number; endPage: number }
```

In the prompt generation (lines 420-422), handle both formats:
```typescript
if (orgContext.pageRange) {
  let rangeText: string;
  if (typeof orgContext.pageRange === 'string') {
    rangeText = orgContext.pageRange;
  } else {
    rangeText = `${orgContext.pageRange.startPage} through ${orgContext.pageRange.endPage}`;
  }
  parts.push(`IMPORTANT: The user has indicated that the actionable plan content is on pages ${rangeText} of the original document. Focus your extraction ONLY on content from those pages.`);
}
```

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/process-plan/index.ts` | (1) Apply `parsePageRange` filter on images before Agent 0 annotations. (2) Skip text_heavy override when pageRange is set. |
| `supabase/functions/extract-plan-items/index.ts` | Normalize `pageRange` type to accept string or object in `processChunk`. |

### What NOT to Change
- Frontend filtering (already works as a first layer)
- `extract-plan-vision` (receives pre-filtered images, no pageRange handling needed)
- Card design, polling, auth

