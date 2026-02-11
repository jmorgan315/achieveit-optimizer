

# Navigation: Back Button + Start Over

## Recommendation

Based on standard wizard UX patterns, here's what works best:

1. **Back button** on every step (except step 1) -- lets users correct mistakes without losing everything
2. **"Start Over" button** on the Review & Export page -- a deliberate reset for when users want to process a different document entirely
3. **Clickable completed steps** in the progress bar -- power-user shortcut to jump back to any completed step

The Back button is the most important -- users expect it in any multi-step flow. "Start Over" is secondary but valuable on the final screen since going back 4 steps one at a time is tedious. Clickable step indicators are a nice-to-have that feel natural.

## UX Details

- **Back button**: Appears as a ghost/outline button with a left arrow, positioned at the bottom-left of each step's content area (mirroring where "Next" buttons typically sit on the right)
- **Start Over**: A subtle destructive-styled button (red text, no fill) on the Review & Export page, positioned near the top or bottom. Shows a confirmation dialog ("You'll lose all changes. Start over?") to prevent accidental resets
- **Clickable progress steps**: Completed steps (with checkmarks) become clickable in the `WizardProgress` bar. Only completed steps are clickable -- you can't skip ahead

## Technical Changes

### 1. `src/components/WizardProgress.tsx`
- Make completed step circles clickable (`cursor-pointer`, `onClick`)
- Accept an `onStepClick` callback prop
- Add hover state styling for completed steps

### 2. `src/pages/Index.tsx`
- Add `handleBack` function: decrements `currentStep` by 1
- Add `handleStartOver` function: resets `currentStep` to 0 and calls a new `resetState` function from `usePlanState`
- Pass `onBack` and `onStartOver` props to the appropriate step components
- Pass `onStepClick` to `WizardProgress` (only allowing navigation to completed steps)

### 3. `src/hooks/usePlanState.ts`
- Add a `resetState` function that resets the entire state back to initial defaults (empty items, default levels, no mappings, no raw text)

### 4. `src/components/steps/PlanOptimizerStep.tsx`
- Add a "Start Over" button (with `AlertDialog` confirmation) near the export button area
- Add a "Back" button

### 5. Step components (`PathSelectorStep`, `PeopleMapperStep`)
- Accept an `onBack` prop and render a Back button alongside their existing action buttons

