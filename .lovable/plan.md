
# Plan: Fix Drag-Drop Nesting, AI Hierarchy Detection, and Performance

## Problem Summary

Three interconnected issues need resolution:

1. **Nesting Broken in Drag-Drop**: The drop position detection uses stale mouse coordinates from drag start instead of current position, making "inside" nesting unreliable
2. **AI Returns Flat Structure**: The Vision AI returns items with `children` as string arrays (names) instead of properly nested item objects. Also, the `columnHierarchy` contains corrupted data like "6130Pillar"
3. **AI Too Slow**: Processing takes 60-80 seconds per batch using Gemini 2.5 Pro with high-resolution images

---

## Solution 1: Fix Drag-Drop Nesting Detection

### Root Cause
In `PlanOptimizerStep.tsx`, the `getDropPosition` function uses:
```typescript
const mouseY = (event.activatorEvent as MouseEvent)?.clientY || 0;
```
This captures the Y position from when the drag STARTED, not the current drag position.

### Fix
Replace `activatorEvent` with the current pointer position from `@dnd-kit/core`'s event data which tracks live position.

**File**: `src/components/steps/PlanOptimizerStep.tsx`
- Use `event.delta` or track pointer position via `useDndMonitor` to get live coordinates
- Add visual feedback indicators (lines/highlights) so users know where items will drop

---

## Solution 2: Fix AI Hierarchy Detection and Nesting

### Root Cause
The Vision AI prompt asks for nested `children` arrays, but the AI is returning children as string names instead of nested objects. This breaks the parent-child relationship building.

Looking at the network response:
```json
{
  "name": "Equity & Access",
  "levelType": "strategic_priority",
  "children": ["Eliminate financial barriers...", "Increase enrollment..."]  // WRONG: strings instead of objects
}
```

The frontend then receives flat items with broken references.

### Fixes

**File**: `supabase/functions/extract-plan-vision/index.ts`

1. **Strengthen the schema**: Make the recursive `children` structure explicit and required as object arrays
2. **Add validation**: Post-process the AI response to rebuild hierarchy if children are strings
3. **Improve prompt**: Add explicit examples of correct JSON structure
4. **Clean column names**: Strip any corrupted prefixes like "6130" from detected terminology

**File**: `src/utils/textParser.ts`

1. **Handle string children**: If `item.children` contains strings instead of objects, reconstruct the hierarchy by matching names
2. **Normalize levelType**: Ensure items get correct depth even if AI returns unexpected values

---

## Solution 3: Speed Up AI Processing

### Current Performance Issues
- Using `google/gemini-2.5-pro` (slowest model, ~60-80s per call)
- Processing only 3 pages per batch = 3 calls for 9 pages
- High resolution images (1.5x scale)

### Optimizations

**File**: `supabase/functions/extract-plan-vision/index.ts`

1. **Switch to faster model**: Use `google/gemini-2.5-flash` for initial extraction (10x faster) with optional Pro refinement for complex documents
2. **Increase batch size**: Process 5-6 pages per batch instead of 3

**File**: `src/utils/pdfToImages.ts`

1. **Reduce image resolution**: Use 1.0x scale instead of 1.5x (smaller images, faster upload and processing)
2. **Use JPEG with lower quality**: Reduce from ~0.8 to ~0.6 quality for faster transfer

**File**: `src/components/steps/FileUploadStep.tsx`

1. **Increase batch size**: Change from 3 to 5 pages per batch
2. **Add parallel processing**: If document is large, consider processing first batch for structure detection while others process content

### Expected Performance Improvement
- Model switch: ~5-10x faster (60s → 6-10s per batch)
- Larger batches: 3 calls → 2 calls for 9 pages
- Smaller images: ~2x faster upload
- **Total: ~20-30 seconds instead of 180+ seconds**

---

## Implementation Tasks

### Task 1: Fix Drop Position Detection
**File**: `src/components/steps/PlanOptimizerStep.tsx`

Replace the stale `activatorEvent` approach with live pointer tracking using `@dnd-kit`'s `DragMoveEvent` or a React ref to track current pointer position.

### Task 2: Add Post-Processing for AI Response
**File**: `src/utils/textParser.ts`

Add a function to detect and fix malformed children arrays:
```typescript
function normalizeAIItems(items: AIExtractedItem[]): AIExtractedItem[] {
  // If children are strings, rebuild as objects by matching names
  // Strip corrupted prefixes from level terms
}
```

### Task 3: Update Vision AI Prompt and Model
**File**: `supabase/functions/extract-plan-vision/index.ts`

- Switch default model to `google/gemini-2.5-flash`
- Add explicit JSON examples in prompt
- Add response validation and cleanup

### Task 4: Optimize Image Processing
**File**: `src/utils/pdfToImages.ts`

- Reduce scale from 1.5 to 1.0
- Reduce JPEG quality from 0.8 to 0.6

### Task 5: Increase Batch Size
**File**: `src/components/steps/FileUploadStep.tsx`

- Change batch size from 3 to 5 pages

---

## File Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `src/components/steps/PlanOptimizerStep.tsx` | Modify | Fix drop position detection for reliable nesting |
| `src/utils/textParser.ts` | Modify | Add normalization for malformed AI responses |
| `supabase/functions/extract-plan-vision/index.ts` | Modify | Switch to faster model, improve prompt, add validation |
| `src/utils/pdfToImages.ts` | Modify | Reduce image resolution and quality |
| `src/components/steps/FileUploadStep.tsx` | Modify | Increase batch size to 5 |

---

## Expected Outcomes

1. **Nesting works reliably**: Users can drag items and clearly see before/after/inside zones with visual indicators
2. **Correct hierarchy detection**: Items are properly nested with 5 levels matching the document's column structure
3. **Fast processing**: Document analysis completes in 20-30 seconds instead of 3+ minutes
