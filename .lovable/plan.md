

# Add Read-Only Results Preview to Admin Session Detail Page

## Overview
Add a collapsible "Results Preview" section below the API Call Timeline on the admin session detail page. Renders the pipeline output as a read-only hierarchical tree with confidence indicators.

## Data Shape (Verified)

Both pipeline paths (normal + resume) write the same structure to `step_results`:

```
step_results.success: boolean
step_results.data.items: nested tree array (each item has name, levelType, confidence, children)
step_results.data.detectedLevels: string[]
step_results.totalItems: number
step_results.sessionConfidence: number
step_results.corrections: array
step_results.dedupResults: array
```

Path `step_results.data.items` is confirmed correct from lines 1191-1193 and 1629 of `process-plan/index.ts`.

## Changes

### 1. New: `src/components/admin/ResultsPreviewTree.tsx`

Lightweight read-only recursive tree renderer:
- Accepts raw items array (from `step_results.data.items`) and total count / confidence
- Confidence summary line at top: "X of Y items high confidence. Z need review."
- Recursive rendering with depth-based indentation (depth × 24px left padding)
- Each row: level badge, confidence dot (green ≥80 / yellow ≥60 / orange ≥40 / red <40), full item name
- Alternating row backgrounds, compact `text-sm` styling
- No interactivity beyond the parent collapsible

### 2. Update: `src/pages/admin/SessionDetailPage.tsx`

- Add `step_results: Json` to `Session` interface
- After API Call Timeline section, add collapsible card:
  - Only renders when `step_results?.data?.items` exists
  - Header: "Results Preview (X items)" with chevron toggle, default collapsed
  - Same pattern as existing `ClassificationCard`
  - Renders `<ResultsPreviewTree>` inside

## Files

| File | Change |
|------|--------|
| `src/components/admin/ResultsPreviewTree.tsx` | New — read-only tree with confidence summary |
| `src/pages/admin/SessionDetailPage.tsx` | Add step_results to interface; add Results Preview section |

