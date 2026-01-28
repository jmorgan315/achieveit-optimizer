

# Plan: Date Validation Tweak and Drag-and-Drop Reordering

## Summary

Two focused changes to improve the Plan Optimizer experience:

1. **Date Validation**: Change from "both dates required" to "both or neither" - if one date is set, the other must be set too
2. **Drag-and-Drop Reordering**: Add the ability to reorder items at the same level, not just nest them under other items

---

## Change 1: Relaxed Date Validation

### Current Behavior
The Edit Item Dialog requires BOTH start and due dates to be filled before saving. The Save button is disabled unless both dates are set.

### New Behavior
- If neither date is set: Save is allowed
- If only one date is set: Save is blocked with a message
- If both dates are set: Validate that due date is on/after start date

### File to Modify

**`src/components/plan-optimizer/EditItemDialog.tsx`**

Update the validation logic and messaging:

```text
Current:
  canSave = startDate && dueDate && dueDate >= startDate

New:
  bothDatesEmpty = !startDate && !dueDate
  bothDatesFilled = startDate && dueDate
  datesValid = bothDatesFilled ? dueDate >= startDate : true
  canSave = (bothDatesEmpty || (bothDatesFilled && datesValid))
```

Also update:
- Remove the `*` required indicators from date labels
- Update the description text to explain the "both or neither" rule
- Update validation messages to reflect the new logic

---

## Change 2: Drag-and-Drop Reordering

### Current Behavior
When dragging an item over another item, it nests the dragged item as a child of the target. There's no way to reorder items at the same level (e.g., move item 1.2 before 1.1).

### New Behavior
The UI will show drop indicators between items (not just on items) so users can:
- **Drop ON an item**: Nest the dragged item as a child (existing behavior)
- **Drop BETWEEN items**: Reorder the dragged item within its siblings

### Implementation Approach

Use `@dnd-kit/sortable` with drop zones that detect whether the user is hovering on the top/bottom edge of an item (reorder) or the center (nest).

### Files to Modify

**`src/components/steps/PlanOptimizerStep.tsx`**

1. Add state to track drop position (`'before' | 'after' | 'inside' | null`)
2. Update `handleDragOver` to calculate drop position based on mouse Y position relative to the hovered item
3. Update `handleDragEnd` to:
   - If drop position is `'inside'`: Use existing `onMoveItem` to nest
   - If drop position is `'before'` or `'after'`: Call new `onReorderSiblings` to reorder

**`src/components/plan-optimizer/SortableTreeItem.tsx`**

1. Add visual indicators for drop zones:
   - Top edge highlight for "drop before"
   - Bottom edge highlight for "drop after"
   - Center/full highlight for "nest inside"
2. Pass `dropPosition` prop to show appropriate indicator

**`src/pages/Index.tsx`**

1. Pass `reorderSiblings` function to `PlanOptimizerStep` as `onReorderSiblings` prop

---

## Technical Details

### Drop Position Detection

```text
function getDropPosition(event, element):
  rect = element.getBoundingClientRect()
  mouseY = event.clientY
  
  topThreshold = rect.top + rect.height * 0.25
  bottomThreshold = rect.bottom - rect.height * 0.25
  
  if mouseY < topThreshold:
    return 'before'
  else if mouseY > bottomThreshold:
    return 'after'
  else:
    return 'inside'
```

### Reorder Logic

When dropping "before" or "after" an item:
1. Get the target item's parent (this determines which sibling group we're reordering)
2. If dragged item has a different parent, first move it to the target's parent
3. Calculate the new index based on the target's position and drop direction
4. Call `reorderSiblings(draggedItemId, newIndex)`

### Visual Indicators

```text
Drop Before:  [===== blue line =====]
              [      Item Row      ]

Drop Inside:  [  light blue bg     ]
              [      Item Row      ]

Drop After:   [      Item Row      ]
              [===== blue line =====]
```

---

## Files Summary

| File | Changes |
|------|---------|
| `src/components/plan-optimizer/EditItemDialog.tsx` | Update date validation: "both or neither" rule, update messaging |
| `src/components/steps/PlanOptimizerStep.tsx` | Add drop position detection, update drag handlers for reorder vs nest |
| `src/components/plan-optimizer/SortableTreeItem.tsx` | Add drop zone indicators (before/after lines, inside highlight) |
| `src/pages/Index.tsx` | Pass `reorderSiblings` handler to `PlanOptimizerStep` |

---

## Expected Outcome

1. **Date Editing**: Users can save items with no dates, or with both dates set. If only one date is entered, they'll see a clear message explaining both are needed.

2. **Drag and Drop**: 
   - Hovering near the top edge of an item shows a blue line above it (drop before)
   - Hovering near the bottom edge shows a blue line below it (drop after)
   - Hovering in the center highlights the item (nest inside)
   - The reordering respects the hierarchy - items reorder within their sibling group

