

## Three Dedup Card Fixes

### Changes

**1. `src/hooks/useAutoSave.ts`** — Accept `dedupResults` as a parameter alongside `items`. Include it in the save payload (`step_results.dedupResults`). Use both `items` and `dedupResults` for the change-detection hash.

**2. `src/pages/Index.tsx`** — 
- Pass `dedupResults` to `useAutoSave`: `useAutoSave(state.items, dedupResults, state.sessionId)`
- Add `handleDismissDedupItem` handler that removes the detail from `dedupResults` state
- Improve `handleRestoreDedupItem` parent matching: (a) fuzzy match `removed_parent` against all item names using normalized `includes` comparison, (b) if no match, try `kept_parent` field, (c) if still no match, insert at root. Add `console.log` for debug tracing of which path was used.
- Pass `onDismissDedupItem` to `PlanOptimizerStep`

**3. `src/components/steps/PlanOptimizerStep.tsx`** — Accept and pass `onDismissDedupItem` prop to `DedupSummaryCard`. Filter out ghost dupes (where `removed_name === kept_name`) before passing to the card.

**4. `src/components/plan-optimizer/DedupSummaryCard.tsx`** — Add `onDismiss` prop. Render a "Dismiss" button (X icon, ghost style) next to the existing Restore button.

**5. `src/types/plan.ts`** — Add optional `kept_parent?: string` to `DedupRemovedDetail` (if not already present).

### Parent Matching Logic (Fix 3)

```text
1. Normalize removed_parent → find item where normalize(item.name) includes normalize(removed_parent) or vice versa
2. If not found, try same with kept_parent  
3. If not found, parentId = null (root)
4. console.log('[Dedup Restore] matched via: ...') for debugging
```

