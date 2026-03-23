

# Fix Extraction Display, Add Dedup, Use Agent 0 Page Filtering

## Problem
Three related issues cause incorrect output on large documents:
1. **Frontend ignores Agent 3's corrected hierarchy** — displays raw flat extraction (63 items all labeled "Goal") instead of corrected 47 items with proper nesting
2. **Duplicate extraction** — summary and detail pages both get extracted, inflating item count
3. **Agent 0's page recommendations ignored** — all pages sent to extraction despite Agent 0 identifying exactly which pages contain plan content

## Changes

### Fix 1: Frontend — Use Agent 3's `correctedItems`

**File: `src/components/steps/FileUploadStep.tsx`** (~lines 368-381, 474-487)

The pipeline's final `step_results.data.items` already contains Agent 3's `correctedItems` (nested with `children` arrays and `levelType` fields) — this is set at line 703-704 of `process-plan/index.ts`. The `convertAIResponseToPlanItems` function in `textParser.ts` already handles nested items with `children` arrays and `levelType` fields (lines 645-721).

**The core issue**: `convertAIResponseToPlanItems` works correctly for nested input BUT the `mergeVisionBatchResults` function (line 304-326) **flattens everything** before merging. So by the time items reach the final result, the nested structure from Agent 3 is already flattened in `agent1Data`. However, Agent 3's `correctedItems` is nested and written correctly to `finalItems` (line 703-704). The final result at line 745-758 writes `finalItems` into `data.items`.

**Actual problem**: The frontend's `convertAIResponseToPlanItems` expects items with `levelType` on each item. Agent 3's corrected items use `levelType` correctly and have proper `children` arrays. But the `isFlatResponse` check may incorrectly detect these as flat if the nesting doesn't match expectations.

**Fix**: In both `extractWithVisionPipeline` and `extractPlanItemsWithAI`, also read `result.corrections` and pass it through to the items so the confidence/correction details display correctly. The `convertAIResponseToPlanItems` function should already handle the nested `correctedItems` correctly — verify by checking `isFlatResponse` logic doesn't misfire on Agent 3 output.

Additionally, pass `result.corrections` into item metadata so the confidence popover shows what Agent 3 changed.

### Fix 2: Batch Merger — Fuzzy Dedup

**File: `supabase/functions/process-plan/index.ts`** (after line 573, before extraction checkpoint)

Add a `deduplicateItems` function that runs after all extraction batches are merged and flattened, before the extraction checkpoint write. Logic:
- Normalize names: lowercase, trim, collapse whitespace
- Group by `level` field
- Within each level group, mark duplicates if: identical normalized names, OR one starts with first 40 chars of other, OR 85%+ word overlap
- Keep item with higher `source_page` (detail > summary), tie-break by longer name
- Preserve `parent_name` from discarded duplicate if keeper lacks one
- Log count: "Dedup: removed N duplicate items, X → Y"

Insert call at ~line 573 (after safety net, before checkpoint):
```
agent1Data.items = deduplicateItems(agent1Data.items);
agent1ItemCount = countAllItems(agent1Data.items);
```

### Fix 3: Use Agent 0's `page_range` Recommendations

**File: `supabase/functions/process-plan/index.ts`** (~lines 401-417)

Replace the current page filtering logic (which only filters for table mode) with universal Agent 0 page filtering:

1. After classification completes (line 383), parse `classification.extraction_recommendations.page_range` into a Set of page numbers
2. If the set is non-empty, filter `images` to only those pages (for ALL extraction modes, not just table)
3. Fall back to current behavior (all pages) if `page_range` is missing/empty
4. Log: "Agent 0 recommended pages [...]. Sending N of M pages to extraction."
5. Remove the old table-only and presentation-mode branching at lines 404-417

Parse logic for `page_range` string (e.g. `"16-17, 25, 27, 29"`):
- Split by comma, trim each
- For ranges like "16-17", expand to individual pages
- Filter to valid indices (1 to images.length)

### Files Summary

| File | Change |
|------|--------|
| `supabase/functions/process-plan/index.ts` | Add `deduplicateItems()` after batch merge; replace page filtering with Agent 0's `page_range`; same for safety net fallback |
| `src/components/steps/FileUploadStep.tsx` | Pass `result.corrections` through to items for confidence display |
| `src/utils/textParser.ts` | No changes needed — already handles nested `correctedItems` correctly |

### What NOT to change
- No agent edge function modifications (classify-document, extract-plan-vision, audit-completeness, validate-hierarchy)
- No polling or session status changes
- No batch construction changes (only which pages go in)
- Keep the flattener as safety net

