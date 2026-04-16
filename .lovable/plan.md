

## Plan: Build Re-Import from Excel Feature

### Summary
Add a complete re-import workflow that lets users export their plan, edit it in Excel, then re-import the edited file. The app parses the file, shows a diff summary, and replaces plan items on confirmation. Gated by `featureFlags.showReimport`.

### Files to Create

**1. `src/utils/reimport-parser.ts`**
- SheetJS-based parser that reads an `.xlsx` file and returns an array of `PlanItem` objects
- Reads first sheet, expects 18-column AchieveIt template header
- Parses dates from M/D/YY to YYYY-MM-DD (reuses `parseSpreadsheetDate` from existing `spreadsheet-parser.ts`)
- Validates enum fields (status, updateFrequency, etc.) — invalid values default to empty string
- Reconstructs parent-child hierarchy from Order column (dot-separated depth)
- Assigns fresh UUIDs to each item
- Returns `{ items: PlanItem[], warnings: string[] }` or throws with a descriptive error

**2. `src/utils/reimport-diff.ts`**
- Takes current `PlanItem[]` and imported `PlanItem[]`, returns a diff summary
- Match strategy: by `order` string (primary), fallback by `name`
- Categorizes items as Added, Removed, Modified, or Unchanged
- For Modified items, tracks which fields changed with old/new values
- Fields compared: name, levelName, description, status, startDate, dueDate, assignedTo, members, administrators, updateFrequency, metricDescription, metricUnit, metricRollup, metricBaseline, metricTarget, currentValue, tags, order

**3. `src/components/plan-optimizer/ReimportDialog.tsx`**
- Three-state dialog: File Select → Diff Preview → Applying
- **File Select**: file input (`.xlsx` only), helper text, calls reimport-parser on selection
- **Diff Preview**: summary counts (unchanged/added/modified/removed), three expandable sections showing details, field-level diffs for modified items
- **Apply**: replaces `state.items` via a new `onApplyReimport` callback, saves reimport metadata to `step_results.reimport`, logs activity, shows success toast
- Error states for invalid/empty files with "Try Again" option

### Files to Modify

**4. `src/components/steps/PlanOptimizerStep.tsx`**
- Import `Upload` icon and `ReimportDialog`
- Add `onApplyReimport` callback prop (receives new `PlanItem[]`)
- Add state: `reimportDialogOpen`
- Render Re-import button next to Export button, gated by `featureFlags?.showReimport`, styled `variant="outline"`
- Render `<ReimportDialog>` passing items, levels, sessionId, and the apply callback

**5. `src/pages/Index.tsx`**
- Implement `onApplyReimport` handler: replaces items in plan state, triggers recalculation of order strings
- Pass it through to `PlanOptimizerStep`

**6. `src/utils/logActivity.ts`**
- Add `'reimport_applied'` to the `ActivityType` union

**7. `src/pages/admin/SessionDetailPage.tsx`**
- Add "Re-import History" section, rendered only when `step_results.reimport` exists
- Shows timestamp, user email, summary stats (added/removed/modified/unchanged)
- Expandable details showing the full change list

### What stays unchanged
- No backend/edge function changes
- No changes to export logic, auto-save, AI pipeline, or original spreadsheet import
- No feature flag system changes — `showReimport` already exists

### Implementation order
1. Create `reimport-parser.ts` and `reimport-diff.ts` (pure utility, no UI)
2. Create `ReimportDialog.tsx` (consumes both utilities)
3. Wire into `PlanOptimizerStep.tsx` and `Index.tsx`
4. Update `logActivity.ts` with new activity type
5. Add admin visibility in `SessionDetailPage.tsx`

