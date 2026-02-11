

# Plan: Dynamic Level Detection and Hierarchy Building

## Problem

The system hardcodes exactly 5 hierarchy levels (`strategic_priority`, `focus_area`, `goal`, `action_item`, `sub_action`) everywhere -- in the AI schema enum, in the prompt examples, in the depth mapping, and in the parent stack. This forces every document into a 5-level mold. The system should instead let the AI detect however many levels the document actually has and use that to build the hierarchy.

## Solution

### Change 1: Remove Fixed Level Enum from AI Schema
**File**: `supabase/functions/extract-plan-items/index.ts`

- Remove the `enum: ["strategic_priority", "focus_area", "goal", "action_item", "sub_action"]` constraint from the `levelType` property in the schema
- Change `levelType` to a free-form string with a description like: "A label for this item's hierarchy level (e.g., 'strategic_priority', 'focus_area', 'goal', or whatever terms the document uses). Items at the same hierarchy depth should use the same levelType string."
- Inline the `children` schema to 4 levels deep (replacing the broken `$ref` that Gemini cannot resolve) -- this is the key fix for why nesting isn't working at all
- The `detectedLevels` array (already in the schema) will tell us what levels exist and their ordering

Update the prompt to:
- Remove the rigid 5-level mapping table (lines 38-43) and replace with guidance: "Identify the hierarchy levels the document uses. Assign a consistent `levelType` string to each level. Report these in `detectedLevels` with depth 1 for the highest level, depth 2 for the next, etc."
- Keep the examples but make them show the principle rather than fixed level names
- Keep all the nesting rules, bullet-point handling, and self-check -- those are good and format-agnostic

### Change 2: Make Depth Mapping Dynamic in textParser.ts
**File**: `src/utils/textParser.ts`

Currently `LEVEL_TYPE_TO_DEPTH` is a hardcoded 5-entry map. Replace this with dynamic mapping:

- Use the `detectedLevels` array from the AI response to build the `levelType -> depth` mapping at runtime
- If `detectedLevels` is missing/empty, fall back to building the map from the unique `levelType` values found in the items (ordered by first appearance at root vs. nested)
- Update `rebuildHierarchyFromFlatItems` to use the dynamic depth map instead of the hardcoded one
- Remove the hardcoded `parentStack` that only goes to 5 -- make it dynamic based on the number of detected levels

### Change 3: Redeploy Edge Function
Deploy the updated `extract-plan-items` function.

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/extract-plan-items/index.ts` | Remove fixed levelType enum; inline children schema 4 levels deep; update prompt to detect levels dynamically |
| `src/utils/textParser.ts` | Build levelType-to-depth map from `detectedLevels`; remove hardcoded `LEVEL_TYPE_TO_DEPTH` and fixed parentStack |

## Why This Fixes the Current Bug Too

The immediate nesting bug (everything flat) is caused by the `$ref` in children that Gemini can't resolve. Inlining the schema fixes that. Making levels dynamic is the broader improvement so the system adapts to any document structure.

## Expected Result

- AI detects the document's actual hierarchy levels (could be 2, 3, 5, or 7 levels)
- `detectedLevels` tells the client what those levels are and their order
- The client maps items to depths dynamically based on what the AI found
- Boulder County document: AI detects 3 levels (Strategic Priority, Focus Area, Goal) and nests accordingly
- A deeper document with 6 levels: AI detects all 6 and they all get proper nesting
- A simple 2-level document: only 2 levels detected and used
