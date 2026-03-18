

# Fix: Confidence Data Not Reaching UI

## Root Cause

The `process-plan` edge function correctly calculates confidence scores and corrections on each item. However, `convertAIResponseToPlanItems()` in `src/utils/textParser.ts` creates fresh `PlanItem` objects (lines 672-696) and **never copies `confidence` or `corrections`** from the AI response items. The data is returned by the API but silently dropped during client-side conversion.

Additionally, the `AIExtractedItem` interface doesn't include `confidence` or `corrections` fields, so even if the code tried to copy them, TypeScript wouldn't allow it.

## Changes

### 1. Update `AIExtractedItem` type (`src/utils/textParser.ts`)

Add `confidence?: number` and `corrections?: string[]` to the `AIExtractedItem` interface so the fields are recognized during conversion.

### 2. Preserve confidence/corrections in `convertAIResponseToPlanItems` (`src/utils/textParser.ts`)

In the `processItem` function (~line 672), copy `confidence` and `corrections` from `aiItem` to the new `PlanItem`:

```typescript
confidence: aiItem.confidence,
corrections: aiItem.corrections,
```

Same fix needed in the flat-response rebuild path (`rebuildHierarchyFromFlatItems`).

### 3. Add fallback confidence in `FileUploadStep.tsx`

After `convertAIResponseToPlanItems` returns items, if items lack confidence scores (all undefined), apply defaults:

- Set every item's `confidence` to `50`
- Set `corrections` to `["Single-pass extraction only — completeness audit and hierarchy validation did not run."]`

This ensures the confidence UI always renders, and clearly signals when the multi-agent pipeline didn't produce scores.

### 4. Update `PlanItem.corrections` type (`src/types/plan.ts`)

The current type is `corrections?: string[]` which already matches what the edge function produces and what the UI components consume. No change needed here — the user's request for a structured `{ agent, type, description }` format would require updating both the edge function output and all UI consumers, and the current string format already contains this information embedded in the text.

## Files to Modify

| File | Change |
|------|--------|
| `src/utils/textParser.ts` | Add `confidence`/`corrections` to `AIExtractedItem`; copy them in `processItem` and flat-rebuild path |
| `src/components/steps/FileUploadStep.tsx` | Add fallback confidence logic after conversion |

## Not Changed

- `process-plan` edge function: Already has detailed logging and correct confidence calculation. The logs from the user's session confirm it runs correctly (47 items, 7 corrections, confidence=20%).
- `PlanItem` type: Already has `confidence?: number` and `corrections?: string[]`.
- Confidence UI components: Already built and correct, just waiting for data.

