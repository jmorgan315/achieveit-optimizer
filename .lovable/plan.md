

# Fix: Stop Filtering Pages for Presentation Mode + Add Low-Item Fallback

## Problem
Agent 0 misclassifies plan content pages as "background", and the orchestrator filters them out before the extractor sees them. The One Chattanooga plan dropped from 47 items to 3-8.

## Change 1: Don't filter pages for presentation mode

**File**: `supabase/functions/process-plan/index.ts`, lines 356-368

Current logic (lines 359-368) filters `images` to only `plan_content_pages` for ALL vision modes. Change to only filter for `table` mode:

```typescript
let images = pageImages as string[];

if (extractionMode === "table" && classification?.plan_content_pages && ...) {
  // Only filter for table mode — tables are reliably classified
  const contentPages = classification.plan_content_pages as number[];
  const filtered = contentPages.filter(...).map(...);
  if (filtered.length > 0) {
    console.log(`[process-plan] Step 1: Filtering from ${images.length} to ${filtered.length} content pages (table mode)`);
    images = filtered;
  }
} else if (extractionMode === "presentation") {
  // Send ALL pages — pass classification as guidance, not a hard filter
  console.log(`[process-plan] Step 1: Sending all ${images.length} pages (presentation mode, classification passed as context)`);
}
```

The `pageAnnotations` and `nonPlanContent` are already being passed to `extract-plan-vision` (lines 397-398), so the extractor already receives the classification hints. This change just stops the hard page filtering.

## Change 2: Low-item safety net with standard-mode fallback

After Agent 1 completes (after line 467), add a check: if extraction produced fewer than 5 items from a document with more than 10 pages, re-run extraction in "standard" mode (no filtering, no specialized prompts) and use whichever result has more items.

```typescript
// Safety net: if suspiciously few items, fallback to standard extraction
const totalPages = (pageImages as string[]).length;
if (useVision && agent1ItemCount < 5 && totalPages > 10) {
  console.warn(`[process-plan] Safety net: only ${agent1ItemCount} items from ${totalPages} pages. Re-running in standard mode...`);
  
  // Re-run with ALL pages, standard mode, no Agent 0 context
  const fallbackBatches = batchImages(pageImages as string[], 5);
  let fallbackItems: unknown[] = [];
  let fallbackLevels = [];
  let fallbackContext = "";
  
  for (let bi = 0; bi < fallbackBatches.length; bi++) {
    if (bi > 0) await new Promise(r => setTimeout(r, 3000));
    const result = await callEdgeFunction("extract-plan-vision", {
      pageImages: fallbackBatches[bi], previousContext: fallbackContext,
      organizationName, industry, documentHints, planLevels, pageRange, sessionId,
      batchLabel: `Safety net (Batch ${bi+1}/${fallbackBatches.length})`,
      extractionMode: "standard",
    });
    if (result.ok && (result.data as any).success) {
      const d = (result.data as any).data;
      if (d.items?.length) fallbackItems = mergeVisionBatchResults(fallbackItems, d.items);
      if (bi === 0 && d.detectedLevels?.length) fallbackLevels = d.detectedLevels;
      if ((result.data as any).contextSummary) fallbackContext = (result.data as any).contextSummary;
    }
  }
  
  const fallbackCount = countAllItems(fallbackItems);
  console.log(`[process-plan] Safety net result: ${fallbackCount} items vs original ${agent1ItemCount}`);
  
  if (fallbackCount > agent1ItemCount) {
    console.log("[process-plan] Using safety net results (more items)");
    agent1Data = { items: fallbackItems, detectedLevels: fallbackLevels.length ? fallbackLevels : agent1Data.detectedLevels };
    // Recalculate
    agent1NameSet = collectItemNameSet(agent1Data.items);
  }
}
```

Note: `agent1NameSet` is declared with `const` on line 466 — will need to change to `let`.

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/process-plan/index.ts` | 1) Only filter pages for table mode, 2) Add low-item fallback after extraction |

