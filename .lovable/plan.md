

## Fix Drag-and-Drop Reorder + Nesting UX

### Problems Found

**Bug 1: Reorder doesn't work when dragging across parents.** In `handleDragEnd` (line 386-408), when `position` is `'before'` or `'after'`, the code calls `onMoveItem` to reparent, then immediately calls `onReorderSiblings`. But these are two separate `setState` calls. `reorderSiblings` reads `item.parentId` from stale state — the move hasn't been applied yet. So when dragging an item to a different parent's sibling group, the reorder either no-ops or targets the wrong sibling list.

**Bug 2: Same-parent reorder can silently no-op.** `reorderSiblings` in `usePlanState.ts` (line 54) returns early if `currentIndex === newIndex`. After the index adjustment in `handleDragEnd` (lines 397-400), the calculated `newIndex` can equal `currentIndex`, causing the drop to appear to succeed but change nothing.

**Bug 3: Edge zones are too small.** The `EDGE_ZONE_PX = 12` means the before/after zones are tiny (12px each out of ~40-48px row height). Most drops land in the large center "inside" zone, making nesting the default behavior when users intend to reorder.

### Fix Plan

#### 1. Increase edge zones and add proportional detection (`PlanOptimizerStep.tsx`)

Change from fixed 12px to proportional zones: top 25% = before, bottom 25% = after, middle 50% = inside. This makes reorder zones much more accessible.

```typescript
const computeDropPosition = useCallback((rect: DOMRect, mouseY: number): DropPosition => {
  const height = rect.height;
  const relativeY = mouseY - rect.top;
  if (relativeY < height * 0.25) return 'before';
  if (relativeY > height * 0.75) return 'after';
  return 'inside';
}, []);
```

#### 2. Fix the cross-parent reorder race condition (`PlanOptimizerStep.tsx`)

Combine the move + reorder into a single operation. Add a new `onMoveAndReorder` callback, or fix by making `reorderSiblings` in `usePlanState` accept an optional `targetParentId` parameter so both the reparent and reorder happen in one `setState`.

**In `usePlanState.ts`**: Add a `moveAndReorder` function that reparents + reorders in a single state update:
```typescript
const moveAndReorder = useCallback((itemId: string, newParentId: string | null, newIndex: number) => {
  setState((prev) => {
    // 1. Reparent the item
    let updatedItems = prev.items.map(i => 
      i.id === itemId ? { ...i, parentId: newParentId } : i
    );
    // 2. Reorder among new siblings
    const siblings = updatedItems.filter(i => i.parentId === newParentId);
    // ... splice logic in single pass
    return { ...prev, items: recalculateOrders(updatedItems, prev.levels) };
  });
}, []);
```

**In `handleDragEnd`**: Replace the two-call pattern with the single `moveAndReorder`.

#### 3. Improve visual indicators (`SortableTreeItem.tsx`)

- Make the before/after indicator lines thicker (h-0.5 → h-1) and add a circular dot at the left edge (standard drag indicator pattern).
- Add a subtle background tint to the entire row for "inside" drops (already exists but could be more prominent).
- The label text is already good — keep the "Reorder before/after" vs "Nest under" labels.

### Files modified

| File | Change |
|------|--------|
| `src/hooks/usePlanState.ts` | Add `moveAndReorder(itemId, newParentId, newIndex)` that reparents + reorders in one setState |
| `src/components/steps/PlanOptimizerStep.tsx` | Change `computeDropPosition` to 25/50/25 proportional zones; replace two-call reorder with single `moveAndReorder`; pass new callback |
| `src/components/plan-optimizer/SortableTreeItem.tsx` | Thicker drop indicator lines (h-1), add left-edge dot, stronger nesting highlight |

