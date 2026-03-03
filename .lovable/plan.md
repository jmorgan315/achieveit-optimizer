

# Stats Bar: Reorder, Color Logic, and Metric Toggle Fix

## Changes (all in `src/components/steps/PlanOptimizerStep.tsx`, lines 401-457)

### 1. Reorder cards
New order: Total Items → Missing Owners → Missing Dates → **With Metrics** → Orphan Items

### 2. Percentage-based coloring
Apply a unified color function based on completion percentage:
- **Total Items**: Always gray (neutral)
- **Missing Owners**: `completionPct = (total - missingOwner) / total` → red/yellow/green
- **Missing Dates**: `completionPct = (total - missingDates) / total` → red/yellow/green  
- **With Metrics**: `completionPct = itemsWithMetrics / total` → red/yellow/green
- **Orphan Items**: Inverted — `completionPct = (total - orphans) / total` → red/yellow/green

Color thresholds: `<50%` = red (`text-destructive`), `50–<75%` = yellow (`text-warning`), `≥75%` = green (`text-green-600`)

Border colors on cards follow the same logic.

### 3. Metric card text & toggle
- Remove `(click: missing)` / `(click: clear)` text
- Three states cycle: "With Metrics" → "Missing Metrics" → clear (back to "With Metrics" label)
- Label shows: `With Metrics` (default/showing-with), `Missing Metrics` (when filtering missing)
- The toggle click handler already cycles correctly; just clean up the label text

### File
- `src/components/steps/PlanOptimizerStep.tsx` — lines ~401-457

