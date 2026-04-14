

## Inline Table: Resizable Columns + Plain Level Text

### Changes — single file: `src/components/plan-optimizer/InlineEditableTable.tsx`

**1. Remove level color coding (lines 168-183)**

Replace the `renderDisplay` callback with plain text:
```tsx
renderDisplay={() => (
  <span className="text-sm text-foreground max-w-[100px] truncate">
    {item.levelName}
  </span>
)}
```

**2. Resizable columns**

- Add `useState` for column widths with defaults: `{ order: 60, level: 110, startDate: 110, dueDate: 110, assignedTo: 160, actions: 110 }`. The drag-handle column (36px) and Name column (1fr) are not resizable.
- Build `gridTemplateColumns` dynamically from state: `` `36px ${widths.order}px ${widths.level}px 1fr ${widths.startDate}px ${widths.dueDate}px ${widths.assignedTo}px ${widths.actions}px` ``
- In each header cell (except drag-handle and Name), add a resize handle on the right edge: a small `<div>` absolutely positioned, 4px wide, full height, `cursor-col-resize`. On `mousedown`, attach `mousemove`/`mouseup` listeners to the document that compute delta and update the corresponding width in state (clamped to a min of 60px).
- Pass the same `gridTemplateColumns` string to both the header and every `InlineEditableRow` via a new prop `columnTemplate`.
- Row currently has `gridTemplateColumns` hardcoded in its style (line 133) — replace with the prop.

### Files to modify

| File | Change |
|------|--------|
| `src/components/plan-optimizer/InlineEditableTable.tsx` | Add column width state, resize handles in header, dynamic grid template, plain level text |

