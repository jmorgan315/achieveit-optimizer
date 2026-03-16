

# Fix: Overly Aggressive Cross-Batch Merge Killing Items

## Root Cause

The `mergeVisionResults` function in `FileUploadStep.tsx` (lines 323-349) is the culprit. The timeline:

1. **Batch 1** (summary pages) → returns 7 root items with **no children** ("Early Learning", "Housing", etc.)
2. **Batch 4** (content pages) → returns 7 root items **with children** ("Build a Universal Path to Early Learning" with 7 initiatives, etc.)
3. `mergeVisionResults` checks if the new item's name contains/matches an existing name. "Early Learning" IS a substring of "Build a Universal Path to Early Learning" → **the real item with children gets dropped as a duplicate**.

Result: 18 items instead of 54. The 7 childless summary items survived, the 7 rich items with ~40 children got killed.

## Fix

Update `mergeVisionResults` to handle the case where a new item is "better" than an existing match (has children when the existing one doesn't). Instead of dropping the new item, **replace** the existing one with it.

### Changes in `src/components/steps/FileUploadStep.tsx`

Replace the current `mergeVisionResults` (lines 323-349) with logic that:
1. When a new item matches an existing item via substring:
   - If the **new** item has children but the **existing** doesn't → **replace** the existing item with the new one
   - If the **existing** item has children but the **new** doesn't → **drop** the new one (current behavior, correct)
   - If both have children → keep both (not really duplicates)
2. When no match → add as new (current behavior, correct)

No edge function changes needed — the server-side dedup is fine; the problem is purely in the client-side cross-batch merge.

### File changed
| File | Change |
|------|--------|
| `src/components/steps/FileUploadStep.tsx` | Fix `mergeVisionResults` to replace childless matches when richer item arrives |

