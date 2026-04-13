

## Inline Editing on Review & Export — Part A (Core Table) — Revised

### Revision from previous plan

The mobile/desktop rendering decision moves entirely into `PlanOptimizerStep.tsx`. `InlineEditableTable` has no mobile guard — it always renders the table. PlanOptimizerStep uses a `useMediaQuery(1024)` check to conditionally render either `InlineEditableTable` or the existing `SortableTreeItem` list.

### New Files

**1. `src/components/plan-optimizer/EditableCell.tsx`** (~400 lines)

Generic click-to-edit cell. Props: `value`, `onChange`, `type` (text | textarea | dropdown | date), `options`, `placeholder`, `readOnly`. Handles display/edit mode, Enter/Escape/onBlur, auto-resizing textarea for Name, Radix Select for dropdowns, Popover+Calendar for dates.

**2. `src/components/plan-optimizer/InlineEditableTable.tsx`** (~300 lines)

The table component. No mobile guard — always renders the full table. Sticky header. Columns: # (60px), Level (100px), Name (flex-grow, wraps, indented by depth, chevron for expand/collapse, confidence dot), Start Date (100px), Due Date (100px), Assigned To (160px), Actions (100px). Each row uses `useSortable` for drag-and-drop. Zebra striping, highlight rows missing name. Each cell edit calls `onUpdateItem(id, { field: value })`.

### Modified File

**3. `src/components/steps/PlanOptimizerStep.tsx`** (~80 lines changed)

- Add `useIsMobile` or a `useMediaQuery` hook with a 1024px breakpoint (e.g. `const isDesktop = useMediaQuery("(min-width: 1024px)")`)
- Remove the `viewMode` state and Summary/Full Editor toggle
- In the tree rendering section, conditionally render:

```text
{isDesktop
  ? <InlineEditableTable ... />
  : <SortableContext ...>
      {flatList.map(item => <SortableTreeItem ... />)}
    </SortableContext>
}
```

- The rendering decision lives in one place (PlanOptimizerStep), not split across components
- All other existing features unchanged: stats bar, confidence banner, dedup cards, export, drag-and-drop, auto-save, edit modal fallback via gear icon

### What stays unchanged
All backend/edge functions, PlanItem type, export logic, auto-save hook, EditItemDialog, admin panel, processing pipeline, summary cards.

