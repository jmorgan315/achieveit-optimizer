

## Add 3 Missing Fields to EditItemDialog

### Changes

**1. `src/types/plan.ts`** — Expand type unions:
- `PlanItemStatus`: add `'Achieved'`, `'Not Achieved'`, `'Cancelled'` to the union
- `UpdateFrequency`: add `'Daily'`, `'Biweekly'` to the union

**2. `src/components/plan-optimizer/EditItemDialog.tsx`** — Add 3 fields:

- **Status dropdown** (after Level, ~line 218): Select with options: Not Started, On Track, Off Track, At Risk, Achieved, Not Achieved, Cancelled. Add `status` to `EditFormData`, initialize from `item.status`, include in `handleSave`.

- **Update Frequency dropdown** (after Owner Email, ~line 296): Select with options: Not Required, Daily, Weekly, Biweekly, Monthly, Quarterly. Add `updateFrequency` to `EditFormData`, initialize from `item.updateFrequency`, include in `handleSave`.

- **Administrators chip input** (after Members, ~line 339): Same pattern as Members — chip badges with X buttons, text input + Add button. Add `administrators` to `EditFormData` with `newAdmin` state, initialize from `item.administrators`, include in `handleSave`.

### Files to modify

| File | Change |
|------|--------|
| `src/types/plan.ts` | Add Achieved, Not Achieved, Cancelled to PlanItemStatus; add Daily, Biweekly to UpdateFrequency |
| `src/components/plan-optimizer/EditItemDialog.tsx` | Add status, updateFrequency, administrators fields to form state and UI |

