

# Add Delete Item Capability

## Approach

Add a delete button in two places for convenience:
1. **Trash icon** on each tree row in `SortableTreeItem` (next to the edit gear icon) for quick access
2. **Delete button** in the `EditItemDialog` footer for when you're already editing an item

Both trigger an `AlertDialog` confirmation before deleting. When an item with children is deleted, its children are also removed (cascading delete).

## Technical Changes

### 1. `src/hooks/usePlanState.ts`
Add a `deleteItem` function that:
- Removes the item and all its descendants from the items array
- Recalculates orders via the existing `recalculateOrders` function

### 2. `src/components/plan-optimizer/SortableTreeItem.tsx`
- Add a `Trash2` icon button next to the existing gear (Settings2) icon
- Accept an `onDelete` callback prop
- Wrap in an `AlertDialog` with confirmation message: "This will permanently delete this item and all its children. This cannot be undone."

### 3. `src/components/plan-optimizer/EditItemDialog.tsx`
- Add a destructive "Delete Item" button on the left side of the footer
- Accept an `onDelete` callback prop
- Wrap in an `AlertDialog` confirmation (same message)
- Close the edit dialog after deletion

### 4. `src/components/steps/PlanOptimizerStep.tsx`
- Wire up the new `onDelete` prop to both `SortableTreeItem` and `EditItemDialog`
- Call `onDeleteItem` (passed from Index.tsx) which invokes `deleteItem` from usePlanState

### 5. `src/pages/Index.tsx`
- Pass `deleteItem` from `usePlanState` down to `PlanOptimizerStep` as `onDeleteItem`

## Confirmation UX

The AlertDialog will show:
- **Title**: "Delete plan item?"
- **Description**: "Are you sure you want to delete '{item name}'? This will also remove any items nested under it. This action cannot be undone."
- **Cancel** button (outline) + **Delete** button (destructive red)

