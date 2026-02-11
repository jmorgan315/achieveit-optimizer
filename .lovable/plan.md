

# Clickable Filter Cards on Review & Export

## Overview
Make the four stat cards (Total Items, Missing Owners, Missing Dates, Orphan Items) clickable to filter the plan tree view to only show matching items.

## How It Works
- Clicking a card activates that filter; clicking it again (or clicking "Total Items") clears the filter
- The active card gets a visual highlight (e.g., ring/border) so you know which filter is on
- When a filter is active, the tree only shows items matching that issue type, plus their ancestor items (so the hierarchy context is preserved)
- "Total Items" acts as a reset/show-all button

## Technical Details

**File**: `src/components/steps/PlanOptimizerStep.tsx`

1. Add a `activeFilter` state: `null | 'missing-owner' | 'missing-dates' | 'orphan'`
2. Make each card a clickable element with `cursor-pointer` and a `ring-2 ring-primary` when active
3. Before building `flatList`, compute a `visibleItemIds` set:
   - If no filter: show all items (current behavior)
   - If filter active: find all items matching the issue type, then walk up `parentId` chains to include ancestors
4. Filter `flatList` entries to only include items in `visibleItemIds`
5. Auto-expand ancestor items when a filter is activated so filtered items are visible
