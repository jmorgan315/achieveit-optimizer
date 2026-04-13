

## UI Polish: Inline Table Styling Fixes

Four CSS-only changes to `InlineEditableTable.tsx` and `EditableCell.tsx`.

### Changes

**1. `src/components/plan-optimizer/InlineEditableTable.tsx`**

- **Order numbers (line 152-156)**: Replace `<Badge variant="outline">` with plain `<span className="text-sm text-muted-foreground">`
- **Level badge (line 170-174)**: Add `max-w-[80px] truncate text-xs` to the Badge inside `renderDisplay`
- **Row group class (line 136)**: Add `group` to the row's className so child elements can use `group-hover:`
- **Action buttons (line 239-277)**: Wrap the actions div with `opacity-0 group-hover:opacity-100 transition-opacity`. Reduce button size classes from `h-7 w-7` to `h-6 w-6`. Reduce icon sizes from `h-3.5 w-3.5` to `h-3 w-3`
- **Row padding**: Change all `py-2` and `py-1` on cells to `py-1` consistently for compact rows

**2. `src/components/plan-optimizer/EditableCell.tsx`**

- **Dropdown trigger (line ~178-188)**: Add `[&>svg:last-child]:opacity-0 [&>svg:last-child]:group-hover:opacity-100` to the `SelectTrigger` className to hide the caret by default and show on row hover. (The `group` class on the parent row enables this.)

### Files to modify

| File | Change |
|------|--------|
| `src/components/plan-optimizer/InlineEditableTable.tsx` | Order as plain text, level badge sizing, action icons hover-only, compact padding, add `group` class |
| `src/components/plan-optimizer/EditableCell.tsx` | Hide dropdown caret until row hover |

