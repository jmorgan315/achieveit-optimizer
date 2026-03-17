

# Fix: Multi-Agent Pipeline Not Running for Vision Path + Over-Extraction

## Root Cause Analysis

### ISSUE 1: Agents 2 and 3 skipped on vision path

The `process-plan` orchestrator IS being called (confirmed by logs: "Pipeline starting", "Agent 1 complete: 54 items"). The problem is downstream:

- **Agent 2 skipped**: Line 324-325 of `process-plan/index.ts` sets `sourceForAudit = documentText || ""`. For vision path, `documentText` is undefined, so `sourceForAudit` is `""`. The `if (sourceForAudit.length > 100)` check fails → Agent 2 is entirely skipped. Log confirms: `"Skipping Agent 2 — no source text for audit"`.

- **Agent 3 crashes**: `validate-hierarchy/index.ts` line 138 requires `sourceText` to be truthy: `if (!sourceText || !extractedItems)` returns 400. The orchestrator passes `sourceText: ""` → Agent 3 returns `"sourceText and extractedItems required"`. Log confirms: `"Agent 3 failed (non-fatal): sourceText and extractedItems required"`.

- **Confidence all 20%**: Since neither Agent 2 nor 3 ran, no items have IDs from Agent 1's ID set (vision extraction doesn't generate IDs matching the `collectItemIds` check), so every item gets confidence=20.

### ISSUE 2: 54 items instead of 47

The vision prompt's SKIP list doesn't exclude core values, vision statements, or indicator tables. The 7 extra items are the Table of Contents entries (the first 7 "strategic_priority" items with no children that appear at the top of the response).

## Changes

### 1. `supabase/functions/validate-hierarchy/index.ts` — Accept empty sourceText

Line 138: Change validation from `if (!sourceText || !extractedItems)` to `if (!extractedItems)`. Make `sourceText` optional — Agent 3 can still validate hierarchy structure and level assignments even without source text.

Update the user message construction (around line 160-180) to handle when `truncatedText` is empty: skip the "SOURCE DOCUMENT" section and add a note saying "No source text available — validate hierarchy structure and level assignments only."

### 2. `supabase/functions/process-plan/index.ts` — Always run Agent 3

Lines 324-342 (Agent 2 section): This is correct — Agent 2 genuinely needs source text. Keep it skipped for vision path. Add a clearer log: `"Skipping Agent 2 — vision-only extraction, no source text available"`.

Lines 349-364 (Agent 3 section): Already calls Agent 3 unconditionally, which is correct. The fix is in validate-hierarchy itself. But add try/catch with full error logging as requested.

Also add the requested console.log statements at each stage for debugging.

### 3. `supabase/functions/extract-plan-vision/index.ts` — Filter non-plan content

Add to the `VISION_EXTRACTION_PROMPT` SKIP section (around line 224-229), these additional exclusions:

```
- Core values, guiding principles, or philosophical statements
- Vision statements or aspirational narratives  
- Statistical indicators or measurement summary tables (unless explicitly tied as sub-items to a goal)
- Section introductions or contextual background text
- Table of contents entries that duplicate actual plan items elsewhere in the document
```

Also add an explicit instruction: "If an item does not have a clear parent-child relationship within the plan hierarchy, it is likely not a plan item."

### Files to modify

| File | What |
|------|------|
| `supabase/functions/validate-hierarchy/index.ts` | Make `sourceText` optional, handle empty gracefully |
| `supabase/functions/process-plan/index.ts` | Add debug logs at each agent stage, try/catch with full error output |
| `supabase/functions/extract-plan-vision/index.ts` | Expand SKIP list to exclude non-plan content |

### Deploy

Deploy all three updated edge functions: `validate-hierarchy`, `process-plan`, `extract-plan-vision`.

