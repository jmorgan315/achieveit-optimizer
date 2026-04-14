

## Fix: Drag-and-Drop Reorder Not Persisting

### Root Cause

The bug is in `recalculateOrders()` (line 345), not in auto-save's change detection.

Here's what happens during a drag reorder:

1. `moveAndReorder` correctly sets new `order` string values on items (e.g., swaps "1" and "2")
2. It then calls `recalculateOrders(updatedItems, prev.levels)`
3. `recalculateOrders` does `items.filter(i => i.parentId === parentId)` — this returns children in their **flat array position order**, completely ignoring the `order` values that were just set
4. It then **reassigns** order strings based on array position, overwriting the reorder
5. The items end up in the same order as before
6. Auto-save correctly detects "nothing changed" and skips — this is correct behavior given the state didn't actually change

### The Fix

In `recalculateOrders`, sort filtered children by their current `order` value before reassigning new hierarchical order strings. This ensures the reorder from `moveAndReorder` is respected.

### Change

**`src/hooks/usePlanState.ts`** — one line change in `recalculateOrders`:

```typescript
function recalculateOrders(items: PlanItem[], levels: PlanLevel[]): PlanItem[] {
  const result: PlanItem[] = [];

  function processLevel(parentId: string | null, prefix: string, treeDepth: number) {
    const children = items
      .filter((i) => i.parentId === parentId)
      .sort((a, b) => {
        // Parse order strings to compare numerically (e.g., "2" vs "10")
        const aParts = a.order.split('.').map(Number);
        const bParts = b.order.split('.').map(Number);
        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
          const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
          if (diff !== 0) return diff;
        }
        return 0;
      });
    // ... rest unchanged
  }
  // ...
}
```

This is a single-file, surgical fix. No other files need changes — auto-save's change detection already includes `order` and `parentId` in its serialization (lines 11 and 30 of `useAutoSave.ts`), so once the reorder actually takes effect in state, auto-save will detect the difference and persist it.

### Files modified

| File | Change |
|------|--------|
| `src/hooks/usePlanState.ts` | Sort children by `order` in `recalculateOrders` before reassigning |

