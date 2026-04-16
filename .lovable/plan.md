

## Plan: Drag-and-Drop, Reimport History, and Feedback Page Enhancements

### 1. Drag-and-drop in ReimportDialog

**File: `src/components/plan-optimizer/ReimportDialog.tsx`**

- Add `isDragging` state and `onDragOver`, `onDragLeave`, `onDrop` handlers to the drop zone `<label>`
- On drop, extract the first file and run the same `processFile(buffer)` logic as `handleFileChange`
- Visual feedback: when dragging over, change border to `border-primary` and background to `bg-primary/5`
- Update text to "Drag & drop a file here, or click to browse"
- Extract the shared parsing logic into a `processFile(buffer: ArrayBuffer)` helper used by both handlers

### 2. Reimport history on Review & Export screen

**File: `src/components/steps/PlanOptimizerStep.tsx`**
- Add a `reimportHistory` prop of type `{ timestamp: string; summary: { added: number; removed: number; modified: number; unchanged: number }; changes: Array<{ type: string; name: string; order: string; fields?: Array<{ field: string; oldValue: string; newValue: string }> }> } | null`
- Render a card between the DedupSummaryCard and the table when `reimportHistory` is present
- Shows: "Last Re-imported [relative date]" header, summary line "+X / -Y / ~Z", expandable details with field-level diffs

**File: `src/pages/Index.tsx`**
- After hydrating `step_results`, extract `step_results.reimport` and pass it as `reimportHistory` prop to `PlanOptimizerStep`
- Also update reimportHistory state after a successful re-import apply (from the ReimportDialog callback)

**New file: `src/components/plan-optimizer/ReimportHistoryCard.tsx`**
- Self-contained card component for displaying reimport history with collapsible change details
- Reuses the same diff display pattern as ReimportDialog (added/removed/modified sections)

### 3. Reimport data on admin Feedback page

**File: `src/pages/admin/FeedbackPage.tsx`**

**Data fetching:**
- After fetching `session_feedback`, also fetch `step_results` for all feedback sessions via the existing `processing_sessions` query (already fetching `id, org_name, document_name` — add `step_results`)
- Extract `step_results.reimport` from each session and attach to the `FeedbackRow` type as `reimport?: { summary: {...}; changes: [...] }`

**Table changes:**
- Add two columns after "Time Saved": "Re-imported" (Yes/No badge) and "Changes" (formatted as `+X / -Y / ~Z` or `—`)
- In the expanded row, if reimport data exists, show field-level change details below the open feedback text

**Summary stats:**
- Add two new stat cards to the grid:
  - "Re-imported" — count and percentage of sessions that were re-imported (e.g., "12 (34%)")
  - "Avg Re-import Changes" — average added/removed/modified per re-imported session (e.g., "+3.2 / -1.1 / ~4.5")

### Technical details

| File | Action |
|------|--------|
| `src/components/plan-optimizer/ReimportDialog.tsx` | Add drag-and-drop handlers, extract shared `processFile` |
| `src/components/plan-optimizer/ReimportHistoryCard.tsx` | New — reimport history display card |
| `src/components/steps/PlanOptimizerStep.tsx` | Add `reimportHistory` prop, render `ReimportHistoryCard` |
| `src/pages/Index.tsx` | Extract and pass `reimportHistory` from step_results |
| `src/pages/admin/FeedbackPage.tsx` | Add reimport columns, expanded details, aggregate stats |

