

# Batch Agent 3 (validate-hierarchy) for Large Item Sets

## Summary

Add batching to Agent 3 so documents with >75 items split into multiple validate-hierarchy calls, each completing within the 150s edge function timeout. Documents with ≤75 items use the existing single-call path unchanged.

## Changes

### 1. validate-hierarchy/index.ts — Add globalContext support

**Single change**: In the request body destructuring (line 151), add `globalContext`. If present, prepend it to the user message before the item listing.

```
- const { extractedItems, auditFindings, ... } = body;
+ const { extractedItems, auditFindings, ..., globalContext } = body;
```

In the user message assembly (line 234), prepend globalContext if present:

```
const globalContextBlock = globalContext ? `=== DOCUMENT CONTEXT ===\n${globalContext}\n\n` : "";
const userMessage = `${globalContextBlock}${contextPrefix}=== EXTRACTED ITEMS === ...`
```

No other changes to validate-hierarchy.

### 2. process-plan/index.ts — Batch orchestration in runAgent3Only

Replace the single `callEdgeFunction` call (lines 1762-1776) with:

**Step A — Threshold check:**
```typescript
const totalItems = countAllItems(agent1Items);
const BATCH_THRESHOLD = 75;
const shouldBatch = totalItems > BATCH_THRESHOLD;
```

**Step B — Single-call path (≤75 items):** Exact current behavior, no changes.

**Step C — Batch grouping (>75 items):**
- Iterate top-level items, count each subtree via `countAllItems([item])`
- Accumulate into current batch until adding next item would exceed 75 (unless batch is empty)
- Result: array of batches, each an array of top-level items with children intact

**Step D — Resume support:**
- Read `stepResults.validationBatches` (object keyed by batch index)
- Skip completed batch indices

**Step E — Sequential batch processing:**
For each uncompleted batch:
- Log timeline: `"Starting Agent 3 batch N of M"`
- Call `callEdgeFunction("validate-hierarchy", { extractedItems: batchItems, auditFindings, detectedLevels, sessionId, organizationName, industry, planLevels, globalContext })` where `globalContext` is the top-level item summary
- On success, persist to `stepResults.validationBatches[batchIndex]` via `updateSessionProgress`
- Check ownership before next batch

**Step F — Merge:**
- Concatenate `correctedItems` and `corrections` from all batches in order
- Construct `validationResult` and feed into existing post-Agent-3 logic (unchanged)

### 3. Timeline logging

- Each batch: validate-hierarchy's existing logging handles this (already includes item/correction counts)
- process-plan: log `"Starting Agent 3 batch N of M"` and `"Agent 3 batch N complete"` and `"Agent 3 all batches complete, merging"`

### 4. Resume state reading

In `runResume` at the `"validating"` branch (line 1636-1640), pass `stepResults` to `runAgent3Only` so it can read `validationBatches`. Add `stepResults` parameter to `runAgent3Only` signature.

## What stays the same

- validate-hierarchy system prompt, tool schema, model, max_tokens
- Agents 0, 1, 2
- Resume cycling / stall detector thresholds
- Post-Agent-3 logic (enforceMaxDepth, applyRephrasedCorrections, calculateConfidence, final persistence)
- Single-call path for ≤75 items

## Files changed

| File | Change |
|------|--------|
| `supabase/functions/validate-hierarchy/index.ts` | Add `globalContext` to destructuring, prepend to user message |
| `supabase/functions/process-plan/index.ts` | Batch orchestration in `runAgent3Only`, per-batch persistence, merge logic, pass `stepResults` |

