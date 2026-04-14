

## Refactor Bulk Action Bar: Single "Edit Field" Dropdown

### Design

Replace 3 separate buttons (Set Assigned To, Set Status, Set Due Date) with one "Edit Field" dropdown. The dropdown lists all editable fields from `ALL_COLUMNS` (excluding `order` and `name` which are readonly/structural). Selecting a field opens an inline input in the bar matching the field's `editType`. An "Apply" button commits the value.

Layout: `[N items selected] | [Edit Field ▼] [inline input + Apply] | [Delete] | [X]`

### Changes

**1. `BulkActionBar.tsx` — Full rewrite**

- Replace `onSetOwner`, `onSetStatus`, `onSetDueDate` props with a single `onBulkUpdate: (field: string, value: string) => void`
- State: `selectedField: ColumnDef | null`, `fieldValue: string`
- Render an "Edit Field" dropdown (using Popover + list, not Select, to avoid auto-closing issues) listing editable fields from `ALL_COLUMNS` filtered to exclude `order`, `name`, `level`
- When a field is selected, show the appropriate inline editor:
  - `text`/`textarea` → Input + Apply button
  - `dropdown` → Select with the field's options, auto-applies on selection
  - `date` → Calendar popover, auto-applies on date selection
- "Apply" calls `onBulkUpdate(field.key, fieldValue)`, resets state
- Keep Delete button and clear selection unchanged

**2. `PlanOptimizerStep.tsx` — Simplify props**

- Replace `onSetOwner`, `onSetStatus`, `onSetDueDate` with single `onBulkUpdate` handler:
  ```
  onBulkUpdate={(field, value) => {
    selectedItems.forEach(id => onUpdateItem(id, { [field]: value }));
    setSelectedItems(new Set());
    toast({ title: 'Updated', description: `Set ${fieldLabel} for ${count} items` });
  }}
  ```

### Editable fields list (15 fields)

From `ALL_COLUMNS`, excluding `order` (readonly) and `name` (structural, always visible):

| Field | Input Type |
|-------|-----------|
| Level | dropdown (dynamic from levels) |
| Description | text input |
| Status | dropdown (STATUS_OPTIONS) |
| Start Date | date picker |
| Due Date | date picker |
| Assigned To | text input |
| Members | text input |
| Administrators | text input |
| Metric Description | dropdown |
| Metric Unit | dropdown |
| Metric Rollup | dropdown |
| Metric Baseline | text input |
| Metric Target | text input |
| Current Value | text input |
| Update Frequency | dropdown |
| Tags | text input |

### Files modified

| File | Change |
|------|--------|
| `src/components/plan-optimizer/BulkActionBar.tsx` | Full rewrite — single Edit Field dropdown with inline editors |
| `src/components/steps/PlanOptimizerStep.tsx` | Replace 3 callback props with single `onBulkUpdate` |

