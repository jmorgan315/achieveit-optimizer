

# Fix Agent 3 (validate-hierarchy) Timeout for Large Documents

## Problem
Agent 3 times out on large documents (287 items) because it includes the full source text (100-180K chars) in the prompt, pushing input to ~50-70K tokens and exceeding the 150s edge function limit. Additionally, `max_tokens: 16384` is too small for 287 items (~21K output tokens needed).

## Changes

### 1. validate-hierarchy/index.ts — Remove sourceText, increase max_tokens, add item count to log

- **Remove** `MAX_SOURCE_LENGTH` constant (line 9)
- **Remove** `sourceText` from destructured request body (line 151) — no longer expected
- **Remove** lines 162-166 (the `truncatedText` logic)
- **Remove** lines 238-243 (the `sourceSection` block that builds `=== SOURCE DOCUMENT ===`)
- **Remove** `${sourceSection}` from the user message template (line 248)
- **Change** `max_tokens` from `16384` to `32768` (line 253)
- In the success log (line 312), change `step_label` to include item count: `` `Step 3: Structure Validation (${result.correctedItems?.length || 0} items, ${result.corrections?.length || 0} corrections)` ``
- In system prompt line 13, soften "match the document's structure" to "match the extracted hierarchy's structure" (since source text is no longer available)

### 2. process-plan/index.ts — Remove sourceText from Agent 3 call

- In `runAgent3Only` function signature (line 1743), remove the `sourceText` parameter
- In the `callEdgeFunction("validate-hierarchy", ...)` payload (line 1763-1772), remove `sourceText`
- At the call site (line 1640), remove `sourceText` from the arguments passed to `runAgent3Only`

### What stays the same

- System prompt logic (other than minor wording tweak)
- Tool schema
- Agent 2 (audit-completeness)
- Extraction pipeline (Agents 0 and 1)
- Resume cycling and stall detector thresholds
- Post-Agent-3 merging logic (confidence scoring, enforceMaxDepth, etc.)

### Expected result
- Prompt drops from ~50-70K tokens to ~10-15K tokens
- Agent 3 completes in 30-60s instead of timing out at 150s
- Output can be up to 32K tokens, sufficient for 400+ items

