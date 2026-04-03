

# Mobile Fixes (375px)

## 3 Issues, 3 Files

### Fix 1: Hide stepper labels on mobile — `WizardProgress.tsx`

The short labels render without spacing and run together. On mobile (`< sm`), hide all text labels and show only dots.

**Change:** On the `<p>` label element (line 57-69), add `hidden sm:block` so the entire label is invisible below `sm`. The dots (h-4 w-4 circles) are sufficient progress indicators at 375px.

### Fix 2: Nav row — stack Back/StartOver below stepper on mobile — `Index.tsx`

The current layout (lines 514-542) is a single `flex` row: `[Back] [stepper] [Download + Start Over]`. At 375px this overflows.

**Change:** Wrap in a `flex-col sm:flex-row` container:
- Top row (always): stepper dots only (full width)
- Bottom row (mobile only, `flex sm:hidden`): Back/Sessions button (left) + Start Over (right), spread with `justify-between`
- On `sm+`: keep current single-row layout with `hidden sm:flex` on the button containers

Move the "Download AchieveIt Import File" button out of the nav row entirely. Place it as a full-width button below the nav bar on mobile (`sm:hidden`), and keep it in the nav row on desktop (`hidden sm:flex`).

### Fix 3: PlanOptimizerStep toolbar — already partially fixed, verify stats grid

The toolbar (line 452) already uses `flex-col sm:flex-row`. The stats grid (line 495) already uses `grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5`. These were applied in the previous round. No further changes needed here — the issue the user sees is likely caused by Fix 2 (the Download button and nav row overflow pushing content off-screen).

## Files to Modify

| File | Change |
|------|--------|
| `src/components/WizardProgress.tsx` | Add `hidden sm:block` to label `<p>` element |
| `src/pages/Index.tsx` | Restructure nav row: stack buttons below stepper on mobile; move Download button out of nav row |

