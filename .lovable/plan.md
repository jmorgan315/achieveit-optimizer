

# Fix Rephrased Item Handling Across the Pipeline

## Problem
Three related bugs prevent rephrased items from being properly tracked, corrected, and displayed:
1. Confidence popover shows "No corrections — extracted cleanly" for rephrased items (confidence=60) because `calculateConfidence` sets the score but never adds a correction string
2. Agent 3 runs in parallel with Agent 2 and receives `auditFindings: null`, so it can't correct rephrased names
3. Agent 2 returns `extractedItemId: "<UNKNOWN>"` because the AI doesn't reliably match IDs

## Changes

### File 1: `supabase/functions/audit-completeness/index.ts`

**BUG 3 fix**: After receiving audit findings from the AI, post-process `rephrasedItems` to resolve `extractedItemId`. Build a name→id lookup from `extractedItems`, then for each rephrased item, fuzzy-match `extractedName` against the lookup to populate the correct ID.

```typescript
// After line 420: const auditFindings = toolUse.input;
// Build name→id map from extractedItems
const nameToId = new Map<string, string>();
function indexItems(items: unknown[]) {
  for (const item of items) {
    const i = item as { id?: string; name?: string; children?: unknown[] };
    if (i.name && i.id) nameToId.set(i.name.toLowerCase().trim(), i.id);
    if (i.children?.length) indexItems(i.children);
  }
}
indexItems(extractedItems);

// Resolve rephrased item IDs
if (auditFindings.rephrasedItems) {
  for (const r of auditFindings.rephrasedItems) {
    if (!r.extractedItemId || r.extractedItemId === "<UNKNOWN>") {
      const match = nameToId.get(r.extractedName?.toLowerCase().trim());
      r.extractedItemId = match || "unknown";
    }
  }
}
```

### File 2: `supabase/functions/process-plan/index.ts`

**BUG 1 fix**: In `calculateConfidence` (around line 160-175), when an item is identified as rephrased via `rephrasedNames`, add a correction description to `correctionDescs` so the popover has something to display. Look up the original text from `auditFindings.rephrasedItems`.

Change the function signature to also accept the full `rephrasedItems` array (not just a Set of names). Then when `rephrasedNames.has(name)` is true, find the matching rephrasedItem and add:
```
"[agent-correction] Completeness Audit: Rephrased during extraction. Original: {originalText}"
```

**BUG 2 fix**: Since Agents 2 & 3 now run in parallel and we can't pass audit findings to Agent 3, handle rephrased corrections in post-processing instead. After the parallel step completes and we have both `auditFindings` and `validationResult`, iterate through `auditFindings.rephrasedItems` and correct item names in `finalItems` directly in the orchestrator (before confidence scoring). This replaces the need for Agent 3 to do it.

Add a new function `applyRephrasedCorrections` after the merge step (around line 658):
```typescript
function applyRephrasedCorrections(
  items: unknown[], 
  rephrasedItems: { extractedName: string; originalText: string }[],
  corrections: { itemId: string; type: string; description: string }[]
): void {
  const rephraseMap = new Map(
    rephrasedItems.map(r => [r.extractedName.toLowerCase().trim(), r.originalText])
  );
  function walk(items: unknown[]) {
    for (const item of items) {
      const i = item as { id?: string; name?: string; children?: unknown[] };
      const key = (i.name || "").toLowerCase().trim();
      if (rephraseMap.has(key)) {
        const original = rephraseMap.get(key)!;
        corrections.push({
          itemId: i.id || "unknown",
          type: "renamed",
          description: `Completeness Audit: Rephrased during extraction. Original: "${original}"`,
        });
        i.name = original; // Fix the name
      }
      if (i.children?.length) walk(i.children);
    }
  }
  walk(items);
}
```

Call it after building `finalItems` and `corrections` but before `calculateConfidence`:
```typescript
if (auditFindings?.rephrasedItems?.length) {
  applyRephrasedCorrections(finalItems, auditFindings.rephrasedItems, corrections);
}
```

This way:
- The item name gets corrected back to the original text (BUG 2)
- A correction entry is added so `calculateConfidence` picks it up and the popover displays it (BUG 1)

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/audit-completeness/index.ts` | Post-process rephrasedItems to resolve extractedItemId from name matching |
| `supabase/functions/process-plan/index.ts` | Add `applyRephrasedCorrections` to fix names + add correction entries; update `calculateConfidence` to include rephrased correction descriptions |

