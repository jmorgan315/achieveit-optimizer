

## Rename "Owner" → "Assigned To" in User-Facing Text

All changes are label/string-only — no variable, prop, or field renames.

### Files to modify

| File | Line(s) | Change |
|------|---------|--------|
| `src/components/plan-optimizer/EditItemDialog.tsx` | ~327 | Label `"Owner Email"` → `"Assigned To"`, placeholder `"owner@company.com"` → `"name@company.com"` |
| `src/components/plan-optimizer/BulkActionBar.tsx` | ~64-78 | Button text `"Set Owner"` → `"Set Assigned To"`, popover label `"Owner Email"` → `"Email"`, placeholder `"owner@email.com"` → `"name@email.com"` |
| `src/components/steps/PlanOptimizerStep.tsx` | ~570 | Stats card label `"Missing Owners"` → `"Missing Assigned To"` |
| `src/components/steps/PlanOptimizerStep.tsx` | ~988 | Toast title `'Owner updated'` → `'Assigned To updated'`, description `'Set owner for…'` → `'Set assigned to for…'` |
| `src/components/steps/PeopleMapperStep.tsx` | ~59 | CardTitle `"Resolve Plan Owners"` → `"Resolve Assigned To"` |
| `src/components/steps/PeopleMapperStep.tsx` | ~133 | Button `"Continue with X Resolved Owners"` → `"Continue with X Resolved"` |
| `src/components/steps/PeopleMapperStep.tsx` | ~123-124 | Pro tip text: `"multiple owners"` → `"multiple assignees"`, `"primary owner's"` → `"primary assignee's"`, `"Additional owners"` → `"Additional assignees"` |
| `src/components/spreadsheet/MappingInterface.tsx` | ~29 | Column role label `'Owner'` → `'Assigned To'` |
| `src/types/plan.ts` | sample data (~212-388) | All `message: 'Missing assigned owner email'` → `'Missing assigned to email'` (these surface in tooltips via `SortableTreeItem`) |

### What stays unchanged
- All internal variable names (`ownerEmail`, `ownerOpen`, `onSetOwner`, `missingOwner`, `ownerColor`, `ownerCol`, etc.)
- All prop names and interfaces
- Database field `owner` in autoSave
- Backend/edge functions
- The `ColumnRole` type value `'owner'`
- The issue type string `'missing-owner'` (internal enum, not user-facing)

