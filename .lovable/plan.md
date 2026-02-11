

# Plan: Fix Text-Based Extraction for Large Multi-Section Documents

## Problem Summary

The AI prompt in `extract-plan-items` actively prevents correct extraction of this document type:

1. **Prompt says "3-7 root items MAX"** - Lines 88-89: "Count root items: Should be 3-7 strategic priorities MAXIMUM" and "If you have >8 root items, your nesting is WRONG." This forces the AI to collapse 50 states into a handful of groups.
2. **`isFlatResponse()` sabotages correct output** - In `textParser.ts` lines 408-409: if >8 root items with few children, it's treated as "flat" and gets restructured, destroying the intended state-per-item layout.
3. **Document structure mismatch** - The prompt assumes corporate strategic plans with few pillars. This document has 50 states, each as a top-level entity with initiatives underneath. The AI needs flexibility to handle both patterns.

## Solution

### Change 1: Update AI Prompt to Handle Large Collections
**File**: `supabase/functions/extract-plan-items/index.ts`

Remove the hard cap of "3-7 root items." Replace with adaptive guidance:

- If the document contains distinct entities (states, departments, regions, projects), each entity should be a root-level `strategic_priority` item
- Nested items under each entity (initiatives, goals, activities) become children
- Keep the nesting rules but remove the arbitrary root count limit
- Add explicit example for multi-entity documents like "50 State Plans" so the AI understands the pattern

Key prompt changes:
- Remove: "Should be 3-7 strategic priorities MAXIMUM" and "If you have >8 root items, your nesting is WRONG"
- Add: Guidance that documents with many distinct entities (states, regions, departments) should have each entity as a root item with their specific items nested underneath
- Add: Instruction to extract ALL entities, not just a sample -- "Do NOT summarize or skip entities. If there are 50 states, return 50 root items."

### Change 2: Fix `isFlatResponse()` Detection
**File**: `src/utils/textParser.ts`

The current logic incorrectly flags 50 states (each with children) as "flat." Fix the heuristic:

- Only consider a response flat if items have NO children AND are all the same levelType
- 50 `strategic_priority` items each WITH children is NOT flat -- it's a valid multi-entity structure
- Raise the threshold or check that items actually have children before flagging

### Change 3: Remove Vision AI Fallback for Text Extraction Failures  
**File**: `src/components/steps/FileUploadStep.tsx`

The `isTextQualityPoor()` check on line 329 can trigger Vision AI even when text extraction succeeds. Make the fallback less aggressive:

- Only fall back to Vision if text is truly empty or corrupted (gibberish ratio check)
- Never fall back just because the document is long or has many pages
- Log why the fallback was triggered so issues can be debugged

## File Changes Summary

| File | Change |
|------|--------|
| `supabase/functions/extract-plan-items/index.ts` | Remove root item count cap, add multi-entity guidance, add "extract ALL" instruction |
| `src/utils/textParser.ts` | Fix `isFlatResponse()` to not flag valid multi-entity responses as flat |
| `src/components/steps/FileUploadStep.tsx` | Make Vision AI fallback less aggressive for text-extracted documents |

## Expected Outcome

- All 50 states appear as root-level items (Level 1: "State Plan")
- Each state has its initiatives/activities nested as children (Level 2+)
- Text-based extraction is used (no Vision AI fallback)
- Existing corporate strategic plan documents still work correctly

