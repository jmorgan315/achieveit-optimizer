

## Make Plan Structure Table Full-Width

### Problem
The entire `PlanOptimizerStep` is constrained to `max-w-6xl` (~1152px), limiting the table workspace.

### Approach
Split the component's layout so the stats bar and top controls stay at `max-w-6xl`, but the Plan Structure `<Card>` breaks out to full width. The parent page container (`main.container` in `Index.tsx`) already provides `px-4` padding.

### Changes

**`src/components/steps/PlanOptimizerStep.tsx`**

1. Remove `max-w-6xl` from the outer wrapper div (line 497). Replace with just `w-full space-y-6`.
2. Wrap the top section (confidence banner, dedup summary, stats bar, controls — everything before the Plan Structure card) in a `<div className="max-w-6xl mx-auto space-y-6">` to keep those elements centered at their current width.
3. The Plan Structure `<Card>` (line 612) and everything after it (bulk action bar, dialogs) stays outside that inner wrapper, so the card stretches to full container width.

This means the layout becomes:
```text
<div className="w-full space-y-6">
  <div className="max-w-6xl mx-auto space-y-6">
    <!-- confidence, dedup, stats, controls -->
  </div>
  <Card>  <!-- Plan Structure — full width -->
    ...
  </Card>
  <!-- dialogs, bulk bar -->
</div>
```

### Files modified

| File | Change |
|------|--------|
| `src/components/steps/PlanOptimizerStep.tsx` | Split layout: constrained top section, full-width table card |

