

# Clean Up: Level Names, Org Profile, Metric Visibility, Context-Aware Optimization

## 1. Fix Level Name Capitalization

**Problem**: AI returns `detectedLevels` with names like `"priority"`, `"focus_area"`, `"action_item"` — these snake_case/lowercase names propagate directly into level names shown in the UI and export.

**Fix**: Add a `cleanLevelName` utility function that replaces underscores with spaces and applies Title Case. Apply it in:
- `convertAIResponseToPlanItems` (textParser.ts) — the fallback on line 654 already does partial cleanup but uses `replace('_', ' ')` which only replaces the first underscore; fix to `replace(/_/g, ' ')`
- `FileUploadStep.tsx` — when building `PlanLevel[]` from `aiResponse.detectedLevels` (lines 219-223 and 313-319), apply the cleaner to each level name
- `extract-plan-vision/index.ts` — clean level names coming from `documentTerminology.columnHierarchy` and `detectedLevels`

**Files**: `src/utils/textParser.ts`, `src/components/steps/FileUploadStep.tsx`, `supabase/functions/extract-plan-vision/index.ts`

## 2. Organization Profile Questionnaire

**Problem**: No org context is captured, so AI recommendations are generic.

**Design**:
- New step inserted **after file upload, before level verification** — a modal or inline form collecting:
  - Organization Name (text input)
  - Industry (select: Local Government, State Government, Federal Government, Healthcare, Non-Profit, Commercial)
- On submit, call a new edge function `lookup-organization` that uses Lovable AI (Gemini) to search for the organization, identify its website, and return a brief profile summary
- Show confirmation card: "Is this your organization? [Name] — [Website] — [Brief description]" with Yes/No
- Store this context in a new `orgProfile` field on `PlanState` (not persisted to DB — session only)
- Pass this context downstream to `suggest-metrics` and any optimize calls

**Files**: New `src/components/steps/OrgProfileStep.tsx`, new `supabase/functions/lookup-organization/index.ts`, update `src/types/plan.ts` (add `OrgProfile` type), update `src/hooks/usePlanState.ts`, update `src/pages/Index.tsx` (add step), update `src/components/WizardProgress.tsx` (add step)

## 3. Metric Visibility in Tree View and Edit Dialog

**Problem**: Items with metrics show no indicator in the tree view, and the Edit dialog doesn't show/edit metric fields.

**Changes**:
- **Tree view indicator** (`SortableTreeItem.tsx`): Add a small badge/icon (e.g., `Target` or `BarChart3` icon) next to items that have a `metricDescription` set, showing a tooltip with metric summary
- **Edit dialog** (`EditItemDialog.tsx`): Add a collapsible "Metrics" section with fields for Metric Description, Unit, Rollup, Baseline, Target, Current Value — matching the fields already in the Optimize dialog but editable inline
- **Stats bar** (`PlanOptimizerStep.tsx`): Add a 5th card showing "Items with Metrics" count (e.g., "12/45"), make it a clickable filter like the existing issue filters — filtering to show only items that have (or are missing) a `metricDescription`
- **Missing metric issue**: Add `missing-metric` to the issues calculation in `usePlanState.ts` so items without metrics are flagged (optional/configurable since not all items need metrics)

**Files**: `src/components/plan-optimizer/SortableTreeItem.tsx`, `src/components/plan-optimizer/EditItemDialog.tsx`, `src/components/steps/PlanOptimizerStep.tsx`, `src/hooks/usePlanState.ts`

## 4. Context-Aware Optimization

**Problem**: The "Optimize" button calls `suggest-metrics` without any org/industry context.

**Fix**:
- Pass `orgProfile` (name, industry, website summary) to `suggest-metrics` edge function
- Update the system prompt in `suggest-metrics/index.ts` to incorporate org context when available
- Update `fetchSuggestion` in `PlanOptimizerStep.tsx` to include org profile in the request body

**Files**: `supabase/functions/suggest-metrics/index.ts`, `src/components/steps/PlanOptimizerStep.tsx`

## Summary of New/Modified Files
- **New**: `src/components/steps/OrgProfileStep.tsx`, `supabase/functions/lookup-organization/index.ts`
- **Modified**: `src/types/plan.ts`, `src/hooks/usePlanState.ts`, `src/pages/Index.tsx`, `src/components/WizardProgress.tsx`, `src/utils/textParser.ts`, `src/components/steps/FileUploadStep.tsx`, `supabase/functions/extract-plan-vision/index.ts`, `src/components/plan-optimizer/SortableTreeItem.tsx`, `src/components/plan-optimizer/EditItemDialog.tsx`, `src/components/steps/PlanOptimizerStep.tsx`, `supabase/functions/suggest-metrics/index.ts`

