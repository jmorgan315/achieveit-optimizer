

# Plan: Add Item-Level Editing for Levels, Dates, and Owners

## Problem Summary

The user needs to edit individual plan items with:

1. **Change individual item levels** - A dropdown to select which level (Strategic Priority, Focus Area, Goal, etc.) an item belongs to
2. **Set start AND due dates** - Both dates are required for AchieveIt compatibility
3. **Assign owners** - Text input for the assigned owner email
4. **Make the gear icon functional** - Currently calls `onEdit(setSelectedItem)` but there's no edit dialog

---

## Solution

Create a comprehensive **Edit Item Dialog** that opens when clicking the gear icon, with required validation for both dates.

---

## Implementation Details

### 1. Add Edit Item Dialog to PlanOptimizerStep

**File: `src/components/steps/PlanOptimizerStep.tsx`**

Add a new dialog for editing individual items:

- Add `showEditDialog` state (boolean)
- Create a form dialog with:
  - **Level dropdown** - Select from configured levels (updates hierarchy position)
  - **Start Date** (required) - Date picker using Calendar + Popover
  - **Due Date** (required) - Date picker, must be after start date
  - **Owner (Assigned To)** - Text input for email
  - **Name** - Editable text
  - **Description** - Editable textarea

**Validation rules:**
- Start Date is required
- Due Date is required
- Due Date must be on or after Start Date
- Save button disabled until both dates are set

### 2. Update SortableTreeItem to Show Inline Info

**File: `src/components/plan-optimizer/SortableTreeItem.tsx`**

Update the row to show:
- Start date and due date in small text (if set)
- Owner email badge (if set)
- Keep the gear icon for opening the edit dialog

### 3. Add changeItemLevel Function

**File: `src/hooks/usePlanState.ts`**

Add a new function `changeItemLevel(itemId: string, newLevelDepth: number)` that:
1. Updates the item's `levelDepth` and `levelName`
2. Handles re-parenting based on new level:
   - If moving to a higher level (e.g., Goal -> Focus Area), find an appropriate parent at the level above or make it a root item
   - If moving to a lower level, find the previous sibling at the level above to become the parent
3. Recalculates order strings for the entire tree

---

## Technical Details

### Edit Dialog Layout

```text
+------------------------------------------+
|  Edit Plan Item                          |
+------------------------------------------+
| Name:        [________________________]  |
| Description: [________________________]  |
|                                          |
| Level:       [Dropdown: Focus Area   v]  |
|                                          |
| Start Date:  [Calendar Picker     ] *    |
| Due Date:    [Calendar Picker     ] *    |
|              * Both dates are required   |
|                                          |
| Owner Email: [________________________]  |
|                                          |
|               [Cancel]  [Save Changes]   |
+------------------------------------------+
```

### Level Change Logic

When user changes an item from "Goal" (depth 3) to "Focus Area" (depth 2):
1. Find the previous sibling at level 1 (Strategic Priority) to become the new parent
2. If no parent found at the appropriate level, make it a root-level item
3. Move all children of the item along with it (they become one level deeper)
4. Recalculate all order strings

### Date Validation

```typescript
const canSave = editFormData.startDate && editFormData.dueDate && 
  new Date(editFormData.dueDate) >= new Date(editFormData.startDate);
```

### Issue Auto-Resolution

When saving the edit dialog:
- If owner email is set and valid, remove `missing-owner` issue
- If both dates are set, remove `missing-dates` issue
- Recalculate remaining issues

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/steps/PlanOptimizerStep.tsx` | Add Edit Item Dialog with level dropdown, required date pickers, owner field |
| `src/components/plan-optimizer/SortableTreeItem.tsx` | Update to show dates/owner inline, connect gear icon to open dialog |
| `src/hooks/usePlanState.ts` | Add `changeItemLevel()` function for level changes with re-parenting logic |

---

## Expected Outcome

After implementation:

1. **Gear icon opens edit dialog** with all editable fields
2. **Level dropdown** allows changing item level with automatic hierarchy adjustment
3. **Required date pickers** for start and due dates (both must be set to save)
4. **Owner field** for entering/editing the assigned email
5. **Issue badges auto-update** when dates/owner are added
6. **Hierarchy recalculates** automatically when level changes

