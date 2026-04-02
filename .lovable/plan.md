

# Fix: `extractionMethod` used before declaration + `batchLabel` not passed to processChunk

## Root Cause Analysis

There are **two code bugs** causing the cascading failure. The "stale batch 5" and out-of-order steps are symptoms, not separate issues.

### Bug 1: `extractionMethod` referenced before declaration (process-plan)

```text
Line 723:  extractionMethod = "text";        ← assignment
Line 739:  let extractionMethod = "text";     ← declaration (with let)
```

JavaScript's temporal dead zone means accessing a `let` variable before its declaration throws `ReferenceError: Cannot access 'extractionMethod' before initialization`. This is the exact error in the logs. The text_heavy override block (line 720-731) runs AFTER classification but BEFORE the `let extractionMethod` declaration at line 739.

**Result**: Pipeline crashes immediately after classifying as text_heavy. No extraction runs. The session is left in a broken state with `document_type: text_heavy` but no extraction data.

### Bug 2: `batchLabel` not passed to `processChunk` (extract-plan-items)

The `batchLabel` variable is destructured from the request body at line 642, but `processChunk` (line 683) is never given it. Inside `processChunk`, the `logApiCall` calls at lines 475 and 572 reference `batchLabel` — which is a closure variable from the outer `serve` handler scope. **However**, `processChunk` is a standalone function defined at line 401, not a closure. So `batchLabel` is `ReferenceError: batchLabel is not defined` inside it.

This is the exact error repeated in the extract-plan-items logs: `"batchLabel is not defined"` at line 585.

**Wait** — looking more carefully, `batchLabel` IS referenced at lines 475 and 572 inside `processChunk`. Since `processChunk` is defined outside the `serve` handler, `batchLabel` is not in scope. This means the `batchLabel` fix from the previous change was incomplete — it added the references inside `processChunk` but never passed `batchLabel` as a parameter.

### The cascade

1. Initial pipeline: classification succeeds → text_heavy override hits Bug 1 → `ReferenceError` → pipeline crashes
2. Stall detector fires resume → resume finds session at `current_step: "extracting"` or broken state with stale `step_results` from the crash
3. Resume tries to continue but extraction data is empty/corrupt → falls through to post-extraction path → sees no items → errors with "no extraction items"
4. This loops ~20 times until MAX_POLLS expires

## Fix

### File: `supabase/functions/process-plan/index.ts`

**Change 1**: Move the `let extractionMethod = "text"` declaration (line 739) to BEFORE the text_heavy override block. Place it right after the classification block ends (~line 715), before line 720.

**Change 2**: Remove the duplicate `let` keyword. Line 739 should just become a conditional assignment inside the `if (useVision)` block: `extractionMethod = "vision"` (no `let`).

### File: `supabase/functions/extract-plan-items/index.ts`

**Change 1**: Add `batchLabel` as an optional parameter to the `processChunk` function signature (line 401-408).

**Change 2**: Pass `batchLabel` from the `serve` handler call site (line 683) to `processChunk`.

## Files changed

| File | Change |
|------|--------|
| `supabase/functions/process-plan/index.ts` | Move `extractionMethod` declaration before the text_heavy override block |
| `supabase/functions/extract-plan-items/index.ts` | Add `batchLabel` parameter to `processChunk` and pass it from caller |

## What stays the same

- All prompts, models, agent logic
- Resume handler logic (it's correct — it just never gets good state because of the crash)
- Frontend stall detector
- Classification logic

