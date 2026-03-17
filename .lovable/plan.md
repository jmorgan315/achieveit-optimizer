

# Option C: Remove Path Step, Add Simple/Full Toggle to Review Step

## Summary
Remove the standalone "Choose Path" wizard step entirely. Add a "Simple View / Full Editor" toggle inside `PlanOptimizerStep`. Simple view shows a summary table with stats and a direct download button. Full view is the existing tree editor. Wizard goes from 5 steps to 4.

## Changes

### 1. Remove Path Step from Wizard (`src/pages/Index.tsx`)
- Remove `PathSelectorStep` import and `ProcessingPath` import
- Update `WIZARD_STEPS` to 4 steps: Organization → Upload Plan → Map People → Review & Export
- Remove `handlePathSelect` handler and `setProcessingPath` from destructuring
- After level confirmation, go directly to People Mapper (step 2 instead of step 3)
- Shift all step indices down by 1 (people = 2, review = 3)
- Update sticky action bar condition from `currentStep === 4` to `currentStep === 3`

### 2. Delete `src/components/steps/PathSelectorStep.tsx`

### 3. Clean up types and state
- Remove `ProcessingPath` type from `src/types/plan.ts`
- Remove `processingPath` from `PlanState` interface
- Remove `setProcessingPath` from `src/hooks/usePlanState.ts`

### 4. Add Simple/Full toggle to `PlanOptimizerStep.tsx`
- Add local state `viewMode: 'simple' | 'full'` (default: `'full'`)
- Add a toggle near the top (next to the stats bar) with two options: "Summary" and "Full Editor"
- **Summary view**: Compact card showing item counts per level, owner/date/metric coverage percentages, and a prominent "Download" button. No tree editing.
- **Full Editor view**: The existing tree view with drag-and-drop, editing, etc. (current behavior)

