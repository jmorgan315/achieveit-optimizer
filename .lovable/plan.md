

## Fix: Page Range Enforcement End-to-End

### Changes

#### 1. `src/components/steps/FileUploadStep.tsx` — Force vision when pageRange is set

At the text quality decision point (line ~845), add a check: if `orgProfile?.pageRange` is set, skip the text path and fall through to the vision path. This ensures filtered page images are sent to the server.

**Current code (line 845):**
```typescript
if (quality.useText) {
```

**New code:**
```typescript
if (quality.useText && !orgProfile?.pageRange) {
```

This single condition change means: when `pageRange` is set, even if text quality is good, we skip the text path and fall through to the vision pipeline at line ~873. The vision pipeline already filters images by `pageRange` before sending. When no `pageRange` is set, text path works as before.

#### 2. `supabase/functions/process-plan/index.ts` — Filter images BEFORE classification

Move the `parsePageRange` filtering block from line ~801 (inside the `if (useVision)` extraction section) to line ~696 (right after `useVision` is determined), so images are filtered before the `classify-document` call.

**Insert after line 696** (`let useVision = ...`):
```typescript
// Filter page images by user-specified page range EARLY — before classification
if (useVision && typeof pageRange === "string" && (pageRange as string).trim()) {
  let imgs = pageImages as string[];
  const maxPage = imgs.length;
  const allowedPages = parsePageRange(pageRange as string, maxPage);
  if (allowedPages.size > 0) {
    const beforeCount = imgs.length;
    imgs = imgs.filter((_, idx) => allowedPages.has(idx + 1));
    console.log(`[process-plan] pageRange "${pageRange}" early filter: ${beforeCount} → ${imgs.length} images`);
    // Mutate body reference so downstream code uses filtered images
    (body as Record<string, unknown>).pageImages = imgs;
  }
}
```

Then **remove** the duplicate filtering block at lines ~801-810 (inside `if (useVision)` extraction section) since it's now done earlier. The `classify-document` call at line ~727 uses `pageImages` from `body`, so it will now receive only the scoped pages.

#### 3. Keep text_heavy + pageRange guard as safety net (no change needed)

The existing block at lines 769-790 stays as-is. It's now a secondary safety net: if somehow the frontend sends images for a text_heavy doc with pageRange, vision is preserved. But the primary enforcement is the frontend (fix #1) and early server filtering (fix #2).

### Files to Modify

| File | Change |
|------|--------|
| `src/components/steps/FileUploadStep.tsx` | Add `&& !orgProfile?.pageRange` to text quality gate (line ~845) |
| `supabase/functions/process-plan/index.ts` | Move `parsePageRange` filtering before classification; remove duplicate block from extraction section |

### What stays the same
- Text path for documents without page range — unchanged
- `extract-plan-items` pageRange normalization — already fixed
- Frontend image filtering in vision pipeline — already working
- text_heavy override logic — stays as safety net

