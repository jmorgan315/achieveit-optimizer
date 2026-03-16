

# Fix Vision AI Hierarchy Detection and Ghost Item Duplication

## Root Cause Analysis

Two distinct bugs are causing both problems:

### Bug 1: Vision schema forces wrong hierarchy
The `extractPlanItemsSchema` in `extract-plan-vision/index.ts` (line 296) has a **hardcoded enum** for `levelType`:
```
enum: ["strategic_priority", "focus_area", "goal", "action_item", "sub_action"]
```
This forces the AI to shoehorn everything into these 5 generic terms, overriding all the prompt guidance about detecting the document's actual terminology. The text extraction pipeline (`extract-plan-items/index.ts`) does NOT have this enum constraint — it uses a free-form string for `levelType`. This is why text extraction sometimes gets hierarchy right but vision never does for simple 2-level documents.

### Bug 2: No deduplication in vision pipeline
The `deduplicateSummaryItems()` function only runs in `extract-plan-items/index.ts` (text pipeline, line 721). The vision pipeline in `extract-plan-vision/index.ts` has no equivalent dedup pass, so ghost summary items survive into the final output. Additionally, `mergeVisionResults` in `FileUploadStep.tsx` only does exact-name dedup across batches — it doesn't catch "Early Learning" vs "Build a Universal Path to Early Learning".

### Bug 3: `<UNKNOWN>` level names in modal
When the AI detects only 2 levels but `DEFAULT_LEVELS` has 5, the level verification modal shows leftover slots as `<UNKNOWN>`. This is a symptom of the schema enum issue — the AI can't express the right level names.

## Proposed Changes

### 1. Fix vision schema — remove levelType enum (`extract-plan-vision/index.ts`)

Change the `levelType` property in `extractPlanItemsSchema` from:
```json
"levelType": { "type": "string", "enum": ["strategic_priority", "focus_area", "goal", "action_item", "sub_action"] }
```
To:
```json
"levelType": { "type": "string", "description": "A label for this item's hierarchy level using the document's actual terminology (e.g., 'goal_area', 'key_priority', 'focus_area'). Items at the same hierarchy depth should use the same levelType string." }
```

This matches what the text pipeline already does and lets the AI use the document's actual terms.

### 2. Add deduplication to vision pipeline (`extract-plan-vision/index.ts`)

Port the `deduplicateSummaryItems()` function from `extract-plan-items/index.ts` into the vision function. Apply it to `extractedData.items` before returning the response (around line 565).

### 3. Add cross-batch fuzzy dedup to `mergeVisionResults` (`FileUploadStep.tsx`)

Update `mergeVisionResults` to use fuzzy substring matching (same logic as `deduplicateSummaryItems`) instead of exact name matching. This catches "Early Learning" being a substring of "Build a Universal Path to Early Learning" across vision batches.

### 4. Fix `<UNKNOWN>` level names — trim levels to match detected count

In `FileUploadStep.tsx`, when building levels from `aiResponse.detectedLevels`, only create `PlanLevel[]` entries for the levels actually detected — don't pad to 5. The current code already does this correctly (lines 385-391 and 292-296), but the vision schema enum was preventing the AI from detecting the right number of levels. Fixing Bug 1 should resolve this automatically.

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/extract-plan-vision/index.ts` | Remove levelType enum, add `deduplicateSummaryItems()`, apply it before response |
| `src/components/steps/FileUploadStep.tsx` | Update `mergeVisionResults` to use fuzzy substring matching |

