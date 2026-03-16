

# Improving AI Hierarchy Detection and Content Filtering

## Problems Identified

**Problem 1: Missed 2-level structure.** The One Chattanooga document has a clear 2-level hierarchy: 7 Goal areas (bold sidebar labels like "BUILD A UNIVERSAL PATH TO EARLY LEARNING") containing 40 numbered Key Priorities. The AI flattened everything to one level ("Goal"), likely because:
- The extraction prompt heavily emphasizes deep nesting (3-5+ levels) with examples, but has no guidance for simple 2-level documents
- The prompt says "Root items SHOULD have children" but doesn't coach the AI on recognizing section headings as parents of numbered lists beneath them
- The bullet-marker heuristic counts numbered items (e.g., "1.", "2.") but doesn't signal to the AI that those numbers under a bold heading = children

**Problem 2: Phantom "summary" items.** The document has a summary page listing the 7 goal area names (Early Learning, The Black Middle Class, Housing, etc.) as short labels. Later pages repeat these as section headings with the actual priorities beneath them. The AI extracted both the summary labels AND the section headings as separate root items, creating duplicates. The prompt says to skip "Table of contents entries" but doesn't address summary/overview pages that restate plan themes without actionable content.

## Proposed Changes

### 1. Update `EXTRACTION_SYSTEM_PROMPT` in `extract-plan-items/index.ts`

Add two new sections to the system prompt:

**A. Simple hierarchy guidance** (after the existing "DYNAMIC LEVEL DETECTION" section):
```
=== SIMPLE HIERARCHIES ARE VALID ===

Not every document has 4-5 levels. Many plans have just 2 levels:
- A plan with 7 "Focus Areas" each containing numbered priorities = 2 levels
- A plan with "Goals" and "Strategies" = 2 levels

When you see a pattern like:
  BOLD HEADING (e.g., "BUILD A UNIVERSAL PATH TO EARLY LEARNING")
    1. First numbered item
    2. Second numbered item
    3. Third numbered item

The heading is Level 1 (parent) and the numbered items are Level 2 (children).
Do NOT flatten this into one level. The heading and its numbered items are DIFFERENT levels.
```

**B. Summary/overview page deduplication** (add to the SKIP section):
```
- Summary or overview pages that list plan themes/goals as short labels when those same themes appear later as full section headings with sub-items. Extract the FULL version (the section heading with its children), NOT the summary version. If you see the same theme name appear both as a standalone label on a summary page and as a heading with items beneath it, use ONLY the heading version.
```

### 2. Update `VISION_EXTRACTION_PROMPT` in `extract-plan-vision/index.ts`

Add equivalent guidance for the vision pipeline:

**A.** In the "NARRATIVE DOCUMENT EXTRACTION" section, add guidance for detecting simple 2-level structures where a bold/large sidebar label groups numbered items.

**B.** In the "SKIP" section, add the same summary-page deduplication rule.

**C.** Update the validation checklist item #5 from:
> "Root level items should be 3-8 strategic priorities, not 20+ flat items"

To:
> "Root level items should match the document's actual top-level groupings. If the document has 7 goal areas each with numbered sub-items, you should have 7 root items with children — NOT 7 root items + 40 flat items at the same level."

### 3. Add a post-extraction deduplication pass in `extract-plan-items/index.ts`

After the verification merge (around line 487), add a lightweight dedup function that:
- Finds root-level items whose name is a substring/fuzzy match of another root item's name
- If the shorter-named item has no children but a longer-named match has children, removes the shorter one
- This catches the "Early Learning" (summary) vs "Build a Universal Path to Early Learning" (section heading with children) pattern

### Summary of file changes
| File | Change |
|------|--------|
| `supabase/functions/extract-plan-items/index.ts` | Add simple-hierarchy and dedup guidance to system prompt; add post-extraction dedup function |
| `supabase/functions/extract-plan-vision/index.ts` | Add equivalent guidance to vision prompt and validation checklist |

No database, UI, or client-side changes needed.

