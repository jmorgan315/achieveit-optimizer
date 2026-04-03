

# Fix Horizontal Overflow on Mobile

## Root Causes

From the screenshots, two main sources of horizontal spill:

### 1. SortableTreeItem rows (line 157)
Each tree row is a single `flex items-center gap-2` containing 10+ elements: grip handle, expand chevron, order badge, level badge, confidence dot, item name, metric/date/owner icons, "Optimize" button (with text), edit icon, delete icon. At depth 1+, there's also `paddingLeft: depth * 24 + 16px`. This row has no `overflow-hidden` or `min-w-0`, so on mobile it pushes well past the viewport.

### 2. Global container
The `<main className="container mx-auto px-4">` in Index.tsx should be fine at 375px, but child content overflowing causes the page body to scroll horizontally.

## Proposed Fixes

### Fix 1: Add `overflow-x-hidden` to the main content wrapper (`Index.tsx`)
On the `<main>` tag, add `overflow-x-hidden` as a safety net to prevent any child from causing horizontal page scroll.

### Fix 2: Make SortableTreeItem responsive (`SortableTreeItem.tsx`)
- Hide the text label on "Optimize" button on mobile — show icon only. Use `<span className="hidden sm:inline">Optimize</span>`.
- Hide the level name badge (`item.levelName`) on mobile: `hidden sm:inline-flex` on that Badge.
- Add `overflow-hidden` and `min-w-0` to the row container so the item name truncates properly instead of pushing the row wider.
- Reduce left padding on mobile: cap indentation e.g. `Math.min(depth, 3) * 16 + 8` on mobile vs current `depth * 24 + 16`.

### Fix 3: Plan Structure card header (`PlanOptimizerStep.tsx` line 613)
The "Plan Structure" header with "Configure Levels" button uses `flex items-center justify-between`. On mobile, "Configure Levels" text could be abbreviated or the button could be icon-only. Add `overflow-hidden` to the card.

## Files to Modify

| File | Change |
|------|--------|
| `src/pages/Index.tsx` | Add `overflow-x-hidden` to `<main>` |
| `src/components/plan-optimizer/SortableTreeItem.tsx` | Hide "Optimize" text on mobile; hide level badge on mobile; add `overflow-hidden min-w-0` to row; reduce indent depth on mobile |
| `src/components/steps/PlanOptimizerStep.tsx` | Add `overflow-hidden` to tree Card container |

