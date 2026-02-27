

# Improve Drag-and-Drop: Clear Nest vs Reorder UX

## Current Problem
The existing drag-and-drop uses mouse Y-position zones (top 20%, middle 60%, bottom 20%) to determine before/after/inside placement. The visual indicators are subtle (thin lines for reorder, light background for nest), making it unclear what action will happen on drop.

## Changes

### 1. Improve drop zone indicators in `SortableTreeItem.tsx`
- **Reorder (before/after)**: Thicker blue line (2px) with a small circle on the left edge, indented to match the target's depth — classic tree reorder indicator
- **Nest (inside)**: Distinct highlighted border with a "nest under" icon/label overlay, using a colored left border + background tint so it's visually distinct from reorder lines
- Add a small text label near the indicator: "Move before" / "Move after" for lines, "Nest under [item name]" for inside drops

### 2. Refine drop zone thresholds in `PlanOptimizerStep.tsx`
- Change zones from 20/60/20 to **25/50/25** — gives reorder zones more room since they're harder to hit
- When dragging an item at the **same level** as the target, bias toward reorder (before/after)
- When dragging an item at a **deeper level** than the target, bias toward "inside" (nesting)

### 3. Improve DragOverlay in `PlanOptimizerStep.tsx`
- Show the current action in the drag overlay: append a small label like "↕ Reorder" or "→ Nest under [target]" so the user always knows what will happen on drop

### 4. Add `data-id` attribute to the sortable item's inner div (`SortableTreeItem.tsx`)
- Currently `data-id` is on a wrapper `div` in the parent. Move/add it to `setNodeRef` element so `document.querySelector` reliably finds the correct bounding rect for drop zone calculation.

## Files Modified
- `src/components/plan-optimizer/SortableTreeItem.tsx` — enhanced visual indicators
- `src/components/steps/PlanOptimizerStep.tsx` — refined thresholds, improved overlay, pass target item info

