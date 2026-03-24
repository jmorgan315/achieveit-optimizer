

# Vision Fallback to Text + Improved Agent 0 Classification

## Problem 1: Vision Failure = Total Failure
When the pipeline uses the vision path and vision extraction fails (error/timeout), the session fails entirely — even if text extraction from `parse-pdf` already succeeded earlier. The frontend discards text results before choosing the vision path.

## Problem 2: Misclassification of Text-Heavy Docs with Tables
Agent 0's classification prompt lacks clear guidance on distinguishing "text_heavy with embedded tables" from truly "tabular" documents. A 57-page government grant application with narrative text and scattered metrics tables was classified as "tabular" at 72% confidence.

---

## Changes

### 1. Frontend: Send documentText alongside pageImages
**File: `src/components/steps/FileUploadStep.tsx`** (~line 378-391)

When the vision path is chosen AND `textResult` was successfully parsed (line 628), also include `documentText: textResult.text` in the `process-plan` request body alongside `pageImages`. This gives the orchestrator text to fall back on if vision fails.

Currently:
```typescript
body: JSON.stringify({
  pageImages: images.map(img => img.dataUrl),
  organizationName: ...,
  ...
})
```

Change to also include `documentText: textResult?.text || ""` — thread `textResult` into `extractWithVisionPipeline` as an optional parameter.

### 2. Backend: Vision fallback to text extraction
**File: `supabase/functions/process-plan/index.ts`** (lines 815-855)

Currently, after vision batches complete, if `allItems` is empty, `agent1Error` is set and the pipeline marks the session as failed (line 847-854).

Change the flow: when vision produces 0 items AND `documentText` exists with substantial content (>50 chars):
1. Log a warning: "Step 1: Vision extraction failed — falling back to text extraction results"
2. Call `extract-plan-items` with `documentText` (the text path)
3. If text extraction succeeds, use those items and set `extractionMethod = "text_fallback"`
4. Only mark as failed if BOTH vision AND text produce 0 items
5. Store `extraction_method: "text_fallback"` in session metadata so admin can see which mode was used

Also handle the case where vision batches partially fail (some batches error out) — the existing logic already handles this via per-batch `console.warn` and continuing. The fallback should only trigger when the final `allItems` count is 0.

### 3. Improve Agent 0 classification prompt
**File: `supabase/functions/classify-document/index.ts`** (lines 62-70, the `document_type` section)

Add clearer classification guidance after the existing document_type definitions. Insert a new section:

```
CRITICAL CLASSIFICATION DECISION — "tabular" vs "text_heavy":

A document is "tabular" ONLY when the plan items themselves are organized as table rows — the tables ARE the plan structure, not supporting data. Examples: a strategic plan formatted as a spreadsheet where each row is a goal/strategy/action with columns for owner, timeline, KPIs.

A document is "text_heavy" even if it contains tables, as long as the plan items (goals, strategies, actions) are primarily expressed in narrative text, headings, and bullet points. Tables for metrics, timelines, budgets, or outcome tracking are supporting data — they do NOT make the document tabular.

Decision rule: If the document has both narrative text AND tables, ask: are the plan items primarily expressed in narrative text or primarily structured as table rows? If narrative text defines the plan and tables provide metrics/data, classify as "text_heavy."

Examples:
- "tabular": Strategic plan where each row is an action item with columns for goal, strategy, owner, timeline, KPI. The table IS the plan.
- "text_heavy": 50-page grant application with narrative sections describing goals and strategies, plus tables showing outcome metrics and timelines. The narrative IS the plan; tables are supporting data.
- "presentation": Slide deck with one goal per slide, visual layouts, large text.
```

Insert this after line 70 (after the "mixed" definition, before "page_annotations classification values").

---

## Files Summary

| File | Change |
|------|--------|
| `src/components/steps/FileUploadStep.tsx` | Thread `textResult.text` into vision pipeline call; send as `documentText` alongside `pageImages` |
| `supabase/functions/process-plan/index.ts` | Add text fallback when vision produces 0 items; log fallback; store extraction_method in session |
| `supabase/functions/classify-document/index.ts` | Add classification decision rule and examples to system prompt |

## What NOT to change
- No agent function changes (extract-plan-vision, extract-plan-items prompts unchanged)
- No dedup, polling, or resume logic changes
- No batch size or page filtering changes
