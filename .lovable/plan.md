

# Plan: Make Extraction Document-Agnostic

## Problem

The current AI prompt forces documents into one of two predefined frameworks: "single organization strategic plan (3-7 root items)" or "multi-entity document (50 states)." This is too rigid. Real-world documents come in endless formats, and the AI should detect and follow whatever structure the document actually has rather than fitting it into a template.

## Solution

### Change 1: Rewrite the AI Prompt to Be Structure-Agnostic
**File**: `supabase/functions/extract-plan-items/index.ts`

Replace the current framework-specific guidance (rules 3 and 4 about "single org" and "multi-entity") with universal instructions:

- Remove all references to "single organization" vs "multi-entity" categorization
- Remove the "3-7 root items" guideline and the "50 states" example framing
- Replace with: "Read the document. Detect its natural structure. Use the hierarchy the document itself presents."
- Keep the core nesting rules (root items should have children, don't flatten everything, use children[] arrays)
- Keep the 5 level types (strategic_priority through sub_action) as the vocabulary for tagging items
- Add instruction: "The number of root items depends entirely on the document. It could be 3, 15, or 50 -- follow what the document shows."
- Simplify the self-check to focus on: "Did you preserve the document's own hierarchy? Do parent items have their children nested?"

Key sections to rewrite:
- Remove rule 3 ("FOR A SINGLE ORGANIZATION'S STRATEGIC PLAN") entirely
- Remove rule 4 ("FOR MULTI-ENTITY DOCUMENTS") entirely
- Replace with a single universal rule about detecting and following the document's natural structure
- Simplify the examples to show generic nesting rather than specific document types

### Change 2: Remove Framework-Specific Heuristics from Smart Rebuild
**File**: `src/utils/textParser.ts`

The `smartRebuildFromSameLevelType` function uses heuristics designed for corporate strategic plans (short titles = priorities, action verbs = goals). These assumptions don't hold for arbitrary document types.

- Simplify the flat-response rebuild: if all items are the same levelType with no children, use `rebuildHierarchyFromFlatItems` which already handles levelType-based ordering
- Remove the title-length and action-verb heuristics that assume a specific document format
- Keep `isFlatResponse()` detection and the `rebuildHierarchyFromFlatItems` fallback as-is since those are format-agnostic

### Change 3: Edge Function Redeployment
Deploy the updated `extract-plan-items` function after prompt changes.

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/extract-plan-items/index.ts` | Rewrite prompt rules 3-4 into a single document-agnostic instruction; simplify examples |
| `src/utils/textParser.ts` | Remove format-specific heuristics from `smartRebuildFromSameLevelType`; simplify to use generic rebuild |

## Expected Result

- Any document type gets its natural hierarchy detected and preserved
- No assumptions about how many root items there "should" be
- The AI reads the document structure as-is rather than forcing it into a template
- Boulder County: 3 root priorities (because the document has 3)
- 50-state document: 50 root items (because the document has 50)
- Any other format: whatever the document actually shows

