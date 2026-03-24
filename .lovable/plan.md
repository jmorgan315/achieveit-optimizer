

# Fix Page Batching, Context Passing, and Dedup

## Problem
Three bugs in `process-plan/index.ts` cause incorrect extraction results on large documents:
1. Using `page_range` string instead of `page_annotations` per-page analysis drops pages
2. Batch context passes wrong items (first 5 items instead of Level 1 only)  
3. Dedup word overlap threshold too high to catch summary/detail OCR variations

## Changes

### Fix 1: Switch page filtering from `page_range` to `page_annotations`

**File: `supabase/functions/process-plan/index.ts`** (lines 515-529)

Replace the `page_range` string parsing with `page_annotations` filtering:
- Read `classification.page_annotations` as an array of `{ page, contains_plan_items, notes }` objects
- Filter to pages where `contains_plan_items === true`
- Map those page numbers to the corresponding images (1-indexed → 0-indexed)
- Fall back to all pages if `page_annotations` is missing or empty
- Add logging: filtered page list before batching, and each batch's page contents
- Add verification: after batching, count total pages across all batches and compare to filtered list

Remove the `parsePageRange` usage for extraction filtering (keep the function since it may be used elsewhere).

### Fix 2: Fix batch context to pass actual Level 1 items

**File: `supabase/functions/extract-plan-vision/index.ts`** (lines 884-888, 965-969, 1049-1052)

Three places build `contextSummary` with `extractedData.items.slice(0, 5)` — this takes the first 5 items regardless of level. Fix all three to filter by level:
- Filter `extractedData.items` to only those with `level === 1` or `level === "1"` or depth/hierarchy indicating top-level
- After flattening, items have a `level` field. Filter where `level === 1`
- If no level-1 items found, fall back to items that have no `parent_name` (top-level items)
- Log the context being passed

### Fix 3: Improve dedup for summary/detail OCR variations

**File: `supabase/functions/process-plan/index.ts`** (in `isDuplicate` and `deduplicateItems`)

- Lower word overlap threshold from 85% to 70%
- Add `parent_name` awareness: if two items share the same `parent_name` (or both null) AND have 70%+ word overlap, they're duplicates
- Add per-item logging when duplicates are found: `"Dedup: removed '[discarded]' (page X), kept '[kept]' (page Y)"`
- When choosing between summary and detail page versions: use `page_annotations` from classification if available — prefer items from pages NOT annotated as "overview"/"summary"/"at-a-glance". Otherwise fall back to higher `source_page` heuristic.

### Files Summary

| File | Change |
|------|--------|
| `supabase/functions/process-plan/index.ts` | Switch to `page_annotations` filtering; improve dedup with lower threshold + parent awareness + per-item logging |
| `supabase/functions/extract-plan-vision/index.ts` | Fix context builder to filter Level 1 items only (3 locations) |

### What NOT to change
- No agent prompt changes
- No frontend changes
- No polling/resume logic changes
- No batch size changes (keep 5 per batch)

