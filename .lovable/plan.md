

## Inline Editing Part B: Column Visibility, Bulk Actions, Polish

This is a large feature set spanning 3 files. The work breaks into four logical chunks.

---

### Change 1: Column Visibility Controls

**In `PlanOptimizerStep.tsx`:**
- Add `visibleColumns` state as `Set<string>`, defaulting to `['order', 'level', 'name', 'startDate', 'dueDate', 'assignedTo']`
- Add a "Columns" button next to "Configure Levels" that opens a Popover
- Popover shows grouped checkboxes (Core, Dates, People, Metrics, Other) with "Show All" / "Reset to Default" buttons
- `name`, `order`, and `actions` columns are always-on (disabled checkboxes)
- Pass `visibleColumns` to `InlineEditableTable`

**In `InlineEditableTable.tsx`:**
- Accept `visibleColumns: Set<string>` prop
- Extend `ColumnWidths` type to include all 18 column keys with sensible defaults (description: 200, status: 120, members: 160, administrators: 160, updateFrequency: 130, metricDescription: 140, metricUnit: 100, metricRollup: 130, metricBaseline: 110, metricTarget: 110, currentValue: 110, tags: 140)
- `buildGridTemplate` dynamically includes only visible columns
- Header and row rendering iterate over a column definition array, conditionally rendering cells based on visibility
- New columns render with EditableCell using appropriate types:
  - `description`: textarea
  - `status`: dropdown (On Track, At Risk, Off Track, Complete, Not Started)
  - `members`, `administrators`: text (comma-separated)
  - `updateFrequency`: dropdown (Weekly, Monthly, Quarterly, Not Required)
  - `metricDescription`: dropdown (Track to Target, Maintain, Stay Above, Stay Below)
  - `metricUnit`: dropdown (Number, Dollar, Percentage)
  - `metricRollup`: dropdown (Manual, Sum Children, Average Children)
  - `metricBaseline`, `metricTarget`, `currentValue`: text
  - `tags`: text (comma-separated)

**Column visibility persistence:** Store in `localStorage` keyed by session ID. On mount, read from localStorage; on change, write to it. This avoids touching autoSave/backend.

---

### Change 2: Missing Field Indicators

Within each cell's rendering in `InlineEditableRow`:
- Name: if empty, placeholder shows "Untitled" in `text-muted-foreground italic`
- Metric Target: if `metricDescription` is set but `metricTarget` is empty, show "—" with `text-amber-500` instead of default muted color
- Start/Due/AssignedTo already show "—" via EditableCell placeholder (no change needed)

---

### Change 3: Bulk Actions

**In `InlineEditableTable.tsx`:**
- Accept `selectedItems: Set<string>`, `onSelectItem: (id: string) => void`, `onSelectAll: () => void` props
- Add a checkbox column (24px) between drag handle and # column
- Header checkbox toggles select-all for visible rows
- Row checkbox toggles individual selection
- Selected rows get `bg-primary/5`

**In `PlanOptimizerStep.tsx`:**
- Add `selectedItems` state as `Set<string>`
- Implement `onSelectItem` (toggle single), `onSelectAll` (toggle all visible flatList items)
- When `selectedItems.size > 0`, render a fixed bottom floating bar:
  - "X items selected" label
  - "Set Owner" button → Popover with email Input + Apply
  - "Set Status" button → dropdown
  - "Set Due Date" button → date picker Popover
  - "Delete" button → AlertDialog confirmation
  - "×" clear selection button
- Each bulk action iterates `selectedItems`, calls `onUpdateItem` for each, then clears selection
- Bulk delete calls `onDeleteItem` for each, with confirmation showing count
- Keyboard: `useEffect` for Escape (clear selection)

---

### Change 4: Performance

**In `InlineEditableTable.tsx`:**
- Wrap `InlineEditableRow` with `React.memo` with a custom comparator checking: `item` fields (by reference or shallow), `isExpanded`, `columnTemplate`, `showConfidence`, `dimmed`, `isOver`, `dropPosition`, `isSelected`, `visibleColumns`
- Add `style={{ contentVisibility: 'auto' }}` on each row wrapper div

---

### Files to modify

| File | Changes |
|------|---------|
| `src/components/plan-optimizer/InlineEditableTable.tsx` | Column visibility filtering, new column cells, checkbox column, selection highlight, React.memo, content-visibility |
| `src/components/steps/PlanOptimizerStep.tsx` | Columns popover button, visibleColumns state, selectedItems state, floating bulk action bar, keyboard shortcuts |

### What stays unchanged
- `useAutoSave.ts` — no changes (column visibility stored in localStorage)
- `EditableCell.tsx` — no changes (already supports all needed types)
- All backend/edge functions, export logic, types, admin panel

