

# Surface Confidence Scores & Correction Logs in Review & Export

## Overview

Add confidence indicators, correction details, discrepancy badges, a session summary card, a "needs review" filter, and an extended export option to the PlanOptimizerStep.

## Data Flow

The `PlanItem` type already has `confidence?: number` and `corrections?: string[]` fields. The extraction pipeline returns these from the process-plan response. We need to:
1. Pass `sessionId` (already available) and session metadata to PlanOptimizerStep
2. Compute aggregate stats from item-level confidence data

## Changes

### 1. Add `SessionSummaryCard` component (`src/components/plan-optimizer/SessionSummaryCard.tsx`)

A new collapsible card at the top of PlanOptimizerStep showing:
- Document name, extraction method, pipeline info
- Total items, agent breakdown (Agent 1 extracted, Agent 2 found missing/rephrased, Agent 3 corrected) — derived from `corrections` strings on items
- Overall confidence (average of all item confidences)
- Processing time, total tokens

Data source: Pass session metadata from `processing_sessions` table. Fetch it in PlanOptimizerStep using `sessionId` on mount (single query).

### 2. Add `ConfidenceBanner` component (`src/components/plan-optimizer/ConfidenceBanner.tsx`)

Below the session summary card:
- Computes average confidence from `items.map(i => i.confidence ?? 100)`
- Color-coded badge: green (90-100), yellow (70-89), red (<70)
- One-line summary: "X of Y items extracted with high confidence. Z items need review."

### 3. Per-item confidence indicators in `SortableTreeItem.tsx`

Add a colored dot before the item name:
- Green: confidence >= 80
- Yellow: confidence 50-79  
- Red: confidence < 50
- No dot if confidence is undefined (treat as 100)

Items with confidence < 80 get `bg-amber-50` background highlight.

Add a `Popover` (not just tooltip — needs to show more content) on the dot showing:
- Confidence score
- List of corrections from `item.corrections[]`
- "View in Admin Logs" link → `/admin/sessions/${sessionId}`

### 4. "Needs Review" filter

Add to the existing filter bar (stats cards row) or as a toggle button above the tree. When active, dims items with confidence >= 80 (reduces opacity) and highlights items < 80. Implement as a new `activeFilter` value: `'needs-review'`.

### 5. Discrepancy badge

Parse `corrections[]` strings to detect discrepancies (e.g., corrections mentioning both "Agent 2" and "Agent 3" on the same item, or items with `confidence <= 20`). Show an orange "Discrepancy" badge on those items in the tree. Include discrepancy details in the confidence popover.

### 6. Export integration

Update `exportToExcel`:
- Accept optional `includeConfidence?: boolean` parameter
- When true, append "Confidence Score" and "Corrections" columns
- In `PlanOptimizerStep`, add a dialog before export with a checkbox "Include AI confidence data"
- Label options: "AchieveIt Import Format" vs "Extended Export (with AI confidence data)"

### 7. Wire session data in `Index.tsx`

No changes needed — `sessionId` is already passed to `PlanOptimizerStep`. The component will fetch its own session metadata.

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/components/plan-optimizer/SessionSummaryCard.tsx` | **Create** — collapsible card with session metadata |
| `src/components/plan-optimizer/ConfidenceBanner.tsx` | **Create** — overall confidence badge + summary line |
| `src/components/plan-optimizer/ConfidencePopover.tsx` | **Create** — per-item popover with score + corrections |
| `src/components/plan-optimizer/SortableTreeItem.tsx` | **Modify** — add confidence dot, background highlight, popover |
| `src/components/steps/PlanOptimizerStep.tsx` | **Modify** — add SessionSummaryCard, ConfidenceBanner, "needs review" filter, export dialog |
| `src/utils/exportToExcel.ts` | **Modify** — add optional confidence columns |

## Execution Order

1. Create `ConfidencePopover` (standalone, reusable)
2. Create `ConfidenceBanner` (computes from items array)
3. Create `SessionSummaryCard` (fetches session data from DB)
4. Update `SortableTreeItem` with confidence dot + popover + highlight
5. Update `exportToExcel` with optional confidence columns
6. Update `PlanOptimizerStep` to wire everything together: banner, summary card, needs-review filter, export dialog

