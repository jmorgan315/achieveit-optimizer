

## Two Fixes for Review & Export

### Fix 1: Restore dedup items to original position

**Problem**: Restored items are appended to the end of the items array, so they appear at the bottom after `recalculateOrders` runs.

**Current data available in `DedupRemovedDetail`**: The server-side dedup stores `removed_item` (the raw AI item with `parent_name`, `name`, etc.), `removed_parent`, and `kept_name`. There's no positional index stored.

**Approach**: 
- **Server side** (`supabase/functions/process-plan/index.ts`): Add `removed_sibling_index` to `DedupRemovedDetail`. When an item is discarded, compute its index among siblings sharing the same `parent_name` in the items array at that point.
- **Type** (`src/types/plan.ts`): Add `removed_sibling_index?: number` to `DedupRemovedDetail`.
- **Restore logic** (`src/pages/Index.tsx` — `handleRestoreDedupItem`): Instead of `[...state.items, newItem]`, insert the new item at the correct position among its siblings. Find all siblings with the same `parentId`, then splice the new item at `removed_sibling_index` (clamped to bounds). If parent not found, append at root. Then call `updateLevelsAndRecalculate` as before — `recalculateOrders` will assign correct order strings based on array position.

### Fix 2: Auto-save edits to database

**Problem**: User edits on the Review & Export screen are lost if the page is refreshed (only in-memory state).

**Approach**:
- **New hook** `src/hooks/useAutoSave.ts`: A small hook that accepts `items`, `sessionId`, and a debounce delay (2s). On items change, debounce a Supabase update: `supabase.from('processing_sessions').update({ step_results: { ...existing, data: { ...existingData, items: convertedItems } } }).eq('id', sessionId)`. The saved items need to be converted back to the raw AI format that `convertAIResponseToPlanItems` expects on hydration.
- **Save indicator**: The hook returns a `saveStatus` state (`'idle' | 'saving' | 'saved'`). 
- **UI** (`src/components/steps/PlanOptimizerStep.tsx`): Accept and display `saveStatus` as a subtle indicator near the Export button — e.g., a small "Saving..." or "Saved ✓" text.
- **Index.tsx**: Wire the hook with `state.items`, `state.sessionId`, and pass `saveStatus` to `PlanOptimizerStep`.
- **Hydration**: Already reads from `step_results.data.items`, so auto-saved changes load automatically on resume.

### Files to modify

| File | Change |
|------|--------|
| `supabase/functions/process-plan/index.ts` | Add `removed_sibling_index` to dedup detail |
| `src/types/plan.ts` | Add `removed_sibling_index` to `DedupRemovedDetail` |
| `src/pages/Index.tsx` | Fix restore position logic; wire auto-save hook |
| `src/hooks/useAutoSave.ts` | New hook: debounced save of items to session |
| `src/components/steps/PlanOptimizerStep.tsx` | Add save status indicator prop + UI |

