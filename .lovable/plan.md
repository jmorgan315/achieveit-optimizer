
# Implementation Plan: Real Functionality for AchieveIt Strategy Tool

## Overview

This plan converts the application from demo mode to production-ready functionality by implementing four key features:
1. Real text parsing from uploaded files
2. Drag-and-drop hierarchy editing
3. PDF document parsing via Lovable Cloud
4. AI-powered metric suggestions via OpenAI

---

## Phase 1: Real Text Parsing Engine

### What We Are Building
A parser that extracts actual plan items, hierarchy, owners, and metrics from uploaded text/CSV files instead of returning hardcoded mock data.

### Changes Required

**File: `src/types/plan.ts`**
- Add a new function `parseTextToPlanItems()` that:
  - Splits text by common delimiters (newlines, bullet points)
  - Uses regex patterns to detect hierarchy indicators (numbering like "1.1.1", indentation, keywords like "Strategic Priority", "Objective", "Initiative")
  - Extracts owner names using patterns like "Owner:", "Assigned:", "Lead:"
  - Extracts dates using patterns like "Start:", "Due:", "Q1 2024"
  - Extracts metrics using patterns like "Target:", "Goal:", percentage/number values

**File: `src/hooks/usePlanState.ts`**
- Replace the `processText()` function to call the new `parseTextToPlanItems(state.rawText, state.levels)` instead of `generateMockPlanItems()`

### Parsing Logic
```text
Input text patterns to detect:
+------------------+------------------------------------------+
| Pattern Type     | Example                                  |
+------------------+------------------------------------------+
| Numbered items   | "1.1.2 Cloud Migration"                  |
| Labeled items    | "Strategic Priority 1: Digital Transform"|
| Owner keywords   | "Owner: John Smith", "Lead: IT Team"     |
| Date keywords    | "Start: Q1 2024", "Due: 12/31/2024"      |
| Metric keywords  | "Target: 80%", "Goal: $2M"               |
+------------------+------------------------------------------+
```

---

## Phase 2: Drag-and-Drop Tree Editing

### What We Are Building
Functional drag-and-drop in the Plan Optimizer that allows users to move items between parent nodes and reorder siblings.

### New Dependency
- `@dnd-kit/core` - Core drag and drop primitives
- `@dnd-kit/sortable` - Sortable preset for lists
- `@dnd-kit/utilities` - CSS transform utilities

### Changes Required

**File: `src/components/steps/PlanOptimizerStep.tsx`**
- Wrap the tree view with `<DndContext>` provider
- Convert each tree item to a `<SortableItem>` component using `useSortable` hook
- Implement `handleDragEnd` to:
  - Detect if item was dropped on another item (reparenting) or between items (reordering)
  - Call `onMoveItem(draggedId, newParentId)` to update hierarchy
- Add visual drop indicators showing where items will land

**File: `src/hooks/usePlanState.ts`**
- The existing `moveItem()` function already handles the state update
- Add `reorderSiblings()` function for same-level reordering

### User Experience
- Drag handle activates on mouse down
- Ghost preview follows cursor
- Drop zones highlight when hovering over valid targets
- Auto-recalculates order strings (1, 1.1, 1.2) after drop

---

## Phase 3: PDF Parsing via Lovable Cloud

### What We Are Building
A Supabase Edge Function that accepts PDF uploads and returns extracted text content.

### Architecture
```text
Browser                    Lovable Cloud
   |                            |
   |-- POST /parse-pdf -------->|
   |   (PDF binary)             |
   |                            |-- Extract text
   |                            |   via unpdf library
   |<-- JSON response ----------|
   |   { text: "..." }          |
```

### New Files

**File: `supabase/functions/parse-pdf/index.ts`**
- Uses `unpdf` library for PDF.js-based text extraction
- Accepts multipart/form-data with PDF file
- Returns JSON with extracted text
- Handles CORS for browser requests

**File: `supabase/config.toml`**
- Configure the edge function with `verify_jwt = false` for public access

### Changes Required

**File: `src/components/steps/FileUploadStep.tsx`**
- When a PDF is uploaded, send it to the edge function
- Show loading state during processing
- On success, populate `fileContent` with the returned text
- On error, show user-friendly message

---

## Phase 4: AI Metric Suggestions via OpenAI

### What We Are Building
Integration with OpenAI's API to generate intelligent metric suggestions based on plan item names and descriptions.

### Prerequisites
- User needs to add an `OPENAI_API_KEY` secret

### New Files

**File: `supabase/functions/suggest-metrics/index.ts`**
- Accepts item name and description
- Calls OpenAI GPT-4o-mini with a prompt designed for strategic planning metrics
- Returns suggested metric name, target value, unit type, and description type
- Prompt engineering focuses on SMART metrics (Specific, Measurable, Achievable, Relevant, Time-bound)

### Prompt Design
The AI will receive context about AchieveIt's metric types:
- Metric Description: Track to Target, Maintain, Stay Above, Stay Below
- Metric Unit: Number, Dollar, Percentage
- Metric Rollup: Manual, Sum Children, Average Children

### Changes Required

**File: `src/components/steps/PlanOptimizerStep.tsx`**
- Replace the mock suggestion logic in the Optimize dialog
- Add loading state while waiting for AI response
- Display AI-generated suggestions with one-click apply
- Add "Regenerate" button for alternative suggestions

---

## Technical Details

### Edge Function: parse-pdf

```text
POST /functions/v1/parse-pdf
Content-Type: multipart/form-data

Response:
{
  "success": true,
  "text": "Strategic Priority 1: Digital Transformation...",
  "pageCount": 5
}
```

### Edge Function: suggest-metrics

```text
POST /functions/v1/suggest-metrics
Content-Type: application/json
{
  "name": "Improve Customer Satisfaction",
  "description": "Enhance all customer touchpoints"
}

Response:
{
  "suggestion": {
    "name": "Increase Customer Satisfaction Score by 15%",
    "metricDescription": "Track to Target",
    "metricUnit": "Percentage",
    "metricTarget": "85",
    "metricBaseline": "70"
  }
}
```

---

## Implementation Order

1. **Text Parsing** (no dependencies) - Get real data flowing first
2. **Drag-and-Drop** (npm install required) - Enable hierarchy fixing
3. **PDF Parsing** (Lovable Cloud required) - Handle binary documents
4. **AI Suggestions** (OpenAI key required) - Add intelligent features

---

## Summary of Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/types/plan.ts` | Modify | Add `parseTextToPlanItems()` function |
| `src/hooks/usePlanState.ts` | Modify | Wire up real parsing, add reorder |
| `src/components/steps/PlanOptimizerStep.tsx` | Modify | Add dnd-kit integration, AI calls |
| `src/components/steps/FileUploadStep.tsx` | Modify | Call PDF parsing edge function |
| `supabase/functions/parse-pdf/index.ts` | Create | PDF text extraction endpoint |
| `supabase/functions/suggest-metrics/index.ts` | Create | AI metric suggestion endpoint |
| `supabase/config.toml` | Create | Edge function configuration |
| `package.json` | Modify | Add @dnd-kit dependencies |
