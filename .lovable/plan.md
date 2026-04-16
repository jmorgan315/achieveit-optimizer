

## Plan: Remove Level Dropdown Caret + Guard Expand State During Drag

### Issue 1: Level column dropdown caret

The `EditableCell` dropdown uses Radix `SelectTrigger` which renders a built-in chevron icon (`svg:last-child`). Current CSS hides it by default and shows on group-hover, but the row has `group` class so it appears on hover — visually conflicting with the expand/collapse chevron in the Name column.

**Fix in `src/components/plan-optimizer/InlineEditableTable.tsx`** (lines 194-215, the level cell rendering):

Change the `EditableCell` for the level column to permanently hide the SelectTrigger caret by adding `[&>svg:last-child]:hidden` to the className. The level text itself already acts as the click target to open the dropdown — no caret needed.

Alternatively (cleaner): pass a className override to EditableCell that forces `[&>svg:last-child]:!hidden` so the caret never renders regardless of hover state.

### Issue 2: Expand/collapse state during drag-and-drop

After investigating, `expandedItems` is only modified in 3 places:
1. Initial `useState` (runs once)
2. `toggleExpand` (user clicks chevron)
3. `handleFilterClick` (when applying a filter)

The drag handler (`handleDragEnd`) does NOT touch `expandedItems`. However, the issue is:

- For imports ≤80 items, **all items start expanded** (line 127: `new Set(items.map(i => i.id))`)
- When an item is dragged to nest under a new parent, the parent was already in `expandedItems`, so the nested child immediately appears — this can look like "unrelated sections expanding"
- More critically: after `moveAndReorder` / `onMoveItem`, the items array changes. If this triggers a parent component remount of `PlanOptimizerStep` (unlikely but worth guarding), the `useState` initializer would re-run and expand everything

**Fix in `src/components/steps/PlanOptimizerStep.tsx`**:

After a drag-and-drop "inside" (nesting) operation, ensure the target parent is added to `expandedItems` so the user sees the result of their action, but do NOT expand any other items. Add the newly dragged item's parent to the set explicitly in `handleDragEnd`:

```typescript
// In handleDragEnd, after onMoveItem or onMoveAndReorder:
setExpandedItems(prev => {
  const next = new Set(prev);
  if (position === 'inside') {
    next.add(targetId); // ensure parent is expanded to show the nested child
  }
  return next;
});
```

This is a minor enhancement. The real guard is ensuring no `useEffect` or external mechanism resets `expandedItems` when items change. Currently there is none, so the state should be stable.

If users are seeing truly unrelated sections expand, it could be a React key issue causing remounts. The `SortableContext` uses `flatList.map(f => f.item.id)` as IDs — these are stable UUIDs, so this shouldn't cause remounts. Will verify during implementation.

### Files changed

| File | Change |
|------|--------|
| `src/components/plan-optimizer/InlineEditableTable.tsx` | Hide SelectTrigger caret on Level column permanently |
| `src/components/steps/PlanOptimizerStep.tsx` | Add parent to expandedItems after nesting drag; verify no expand-state leaks |

