

# Fix: Flatten Nested Items to Prevent Child Loss During Batch Merging

## Root Cause

The extraction pipeline has two compounding issues:

1. **Standard mode user prompt** (line 777 in `extract-plan-vision/index.ts`) explicitly instructs "Return NESTED items with children arrays, not a flat list" — this conflicts with presentation/table modes that use flat output
2. **`mergeVisionBatchResults`** in `process-plan/index.ts` (line 258) only checks top-level item names for deduplication. When batch 1 returns `Goal A` with 10 children, and batch 2 also references `Goal A`, the merger sees it as duplicate and drops it — along with any NEW children from batch 2. All non-top-level items are invisible to the merger.

The logs confirm this: Batch 1 returns 7 items, Batch 2 returns 1, Batch 3 returns 3, Batch 4 returns 3 → total after merging = 8 (only top-level). The ~40 child items (Key Priorities) are lost.

## Changes

### File 1: `supabase/functions/extract-plan-vision/index.ts`

**FIX 1a**: Remove the nesting instruction from the user prompt (line 777).

Change line 777 from:
```
5. Return NESTED items with children arrays, not a flat list
```
to:
```
5. Extract ALL items at every level of the hierarchy
```

**FIX 1b**: The standard mode system prompt (`VISION_EXTRACTION_PROMPT`, lines 169-210) also instructs nested output with children arrays, and the tool schema (line 307) defines `children` as a recursive field. These are fundamental to how standard mode works, so we won't change the system prompt — instead we'll handle it in the orchestrator with a flattener.

### File 2: `supabase/functions/process-plan/index.ts`

**FIX 2**: Add a `flattenItems` function and apply it to each batch result before merging.

```typescript
function flattenItems(items: unknown[]): unknown[] {
  const flat: unknown[] = [];
  for (const item of items) {
    const i = item as Record<string, unknown>;
    const { children, ...rest } = i;
    flat.push(rest);
    if (Array.isArray(children) && children.length > 0) {
      flat.push(...flattenItems(children));
    }
  }
  return flat;
}
```

Apply this in the extraction loop (around line 408) before calling `mergeVisionBatchResults`:

```typescript
if (d.items?.length) {
  const flatBatchItems = flattenItems(d.items);
  allItems = mergeVisionBatchResults(allItems, flatBatchItems);
}
```

Also apply in the safety net fallback (around line 509):

```typescript
if (innerData.items?.length) {
  const flatFallbackItems = flattenItems(innerData.items);
  fallbackItems = mergeVisionBatchResults(fallbackItems, flatFallbackItems);
}
```

**FIX 3**: Also flatten items in `mergeVisionBatchResults` itself as a safety belt — the `collectNames` helper already traverses children for dedup names, but the actual merge only adds top-level items. After flattening inputs, `collectNames` traversal of children becomes unnecessary but harmless.

### Downstream Impact

The rest of the pipeline (validate-hierarchy, confidence scoring, final output) already handles both flat and nested formats — `countAllItems` and `collectItemNameSet` traverse children recursively, and `calculateConfidence` does too. The frontend (`usePlanState.ts`) builds its own tree from `parentId` fields. So flattening at merge time is safe — the hierarchy is reconstructed later from `levelDepth`/`parent_name` fields.

### Files to modify

| File | Change |
|------|--------|
| `supabase/functions/extract-plan-vision/index.ts` | Remove "Return NESTED items" from user prompt (line 777) |
| `supabase/functions/process-plan/index.ts` | Add `flattenItems()` function; apply before `mergeVisionBatchResults` in both extraction loop and safety net |

