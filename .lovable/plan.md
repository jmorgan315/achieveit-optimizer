

# Fix: Restore Proper Hierarchical Extraction for Standard Strategic Plans

## Problem

The AI extraction returns all 68 items flat as `strategic_priority` with no children. This is a regression caused by the recent prompt changes that added multi-entity guidance (for 50-state documents). The model now incorrectly treats every line item as a root entity instead of properly nesting them.

The Boulder County document has a clear 3-level hierarchy:
- 3 Strategic Priorities (Economic Security, Climate Action, Good Governance)
  - Numbered Focus Areas (1. Housing, 2. Mental Health, etc.)
    - Bullet point Goals/Actions under each

## Root Cause

Two issues working together:

1. **AI Prompt**: The multi-entity guidance ("If there are 50 states, return 50 root items") may be overriding the nesting instructions, causing the model to put everything at root level
2. **Flat rebuild fallback**: When all items are returned as `strategic_priority`, the `rebuildHierarchyFromFlatItems()` function maps them all to depth 1, so no hierarchy gets reconstructed

## Solution

### Change 1: Strengthen AI Prompt Hierarchy Instructions
**File**: `supabase/functions/extract-plan-items/index.ts`

Rebalance the prompt to strongly emphasize nesting for standard strategic plans while keeping multi-entity support:

- Move the nesting/hierarchy rules ABOVE the multi-entity guidance so the model sees them first
- Add explicit instruction: "For a single organization's strategic plan, there should be only a few root strategic_priority items (typically 3-7) with everything else nested as children"
- Add a clarifying note that multi-entity guidance only applies when the document clearly contains multiple distinct organizations/entities/locations
- Add stronger emphasis: "EVERY bullet point and numbered item MUST be nested as a child, never at root level"

### Change 2: Smarter Flat Response Rebuild
**File**: `src/utils/textParser.ts`

When `isFlatResponse()` detects a flat response AND all items share the same `levelType`, add smarter reconstruction:

- If all items are `strategic_priority`, use name-based heuristics to detect which ones are actual top-level priorities vs. sub-items:
  - Short, title-like names (under ~60 chars, no verbs like "Increase", "Implement") are likely real priorities
  - Longer, action-oriented names starting with verbs are likely goals/action items
  - Numbered items ("1. Housing access") are likely focus areas
- Group action-oriented items under the nearest preceding title-like item
- This provides a safety net even when the AI prompt improvements fail

### Change 3: Add logging for debugging
**File**: `src/utils/textParser.ts`

Add a console.log in `convertAIResponseToPlanItems` that logs:
- Number of root items returned by AI
- How many have children
- Whether `isFlatResponse` triggered
- The levelTypes distribution

This helps debug future regressions without needing to check edge function logs.

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/extract-plan-items/index.ts` | Rebalance prompt: prioritize nesting rules, scope multi-entity guidance to only apply when document clearly has multiple entities |
| `src/utils/textParser.ts` | Add smart flat-response rebuild that can handle all-same-levelType items; add debug logging |

## Expected Result

- Boulder County PDF: 3 root strategic priorities, each with numbered focus areas and bullet-point goals nested underneath (roughly matching the original working behavior)
- 50-state document: Still works with 50 root items, since multi-entity guidance is preserved (just scoped more carefully)

## Technical Notes

- The prompt changes are the primary fix; the smart rebuild is a safety net
- The Gemini model's context window easily handles 21k characters, so this is purely a prompt quality issue
- Edge function will need redeployment after changes
