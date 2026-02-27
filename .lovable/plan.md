

## Clearer Drag-and-Drop: Hover-to-Nest, Edge-to-Reorder

### Problem
The current 25/50/25 vertical zone approach makes it hard to tell what will happen on drop. "Move before" and "Move after" labels don't convey *at what level* the reorder applies. Users want:
- **Mouse in middle of an item** → nest under that item
- **Mouse near the border/gap between two items** → reorder (before/after) at the same level as the target

### Changes

#### 1. Simplify drop zones to a narrow-edge model (`PlanOptimizerStep.tsx`)
- Use a **12px edge zone** at the top and bottom of each item row for reorder (before/after)
- Everything else (the large center area) = **nest inside**
- Remove the percentage-based and same-parent-bias logic — the pixel-based edge approach is more intuitive and predictable

#### 2. Improve visual indicators (`SortableTreeItem.tsx`)
- **Nest (center hover)**: Bold left border + background tint + label "Nest under [item name] as [level name]" — showing the *resulting level name* so users know what level the item will become
- **Reorder (edge hover)**: Horizontal line at the exact gap between items. Label shows "Reorder [before/after] [item name]" with the level name context
- Remove the current circle-and-line indicators in favor of a cleaner full-width separator line for reorder

#### 3. Show resulting level name in drag overlay (`PlanOptimizerStep.tsx`)
- When nesting: "→ Nest under [target] as [child level name]"
- When reordering: "↕ Reorder as [target's level name]"
- This uses the `levels` array to look up `targetItem.levelDepth + 1` for nest, or `targetItem.levelDepth` for reorder

### Files Modified
- `src/components/plan-optimizer/SortableTreeItem.tsx`
- `src/components/steps/PlanOptimizerStep.tsx`

