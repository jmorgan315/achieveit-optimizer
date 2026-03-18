

# Fix Confidence Scoring — Root Cause & Solution

## Root Cause

Agent 1 (both vision and text extraction) does NOT generate `id` fields on items — the schema doesn't include an `id` property. Agent 3 (validate-hierarchy) generates its own IDs when it returns `correctedItems`.

In `calculateConfidence`, `collectItemIds(agent1Data.items)` returns an **empty set** because Agent 1 items have no IDs. Then for every item in Agent 3's output, `!agent1Ids.has(id)` is `true` → confidence = 20 ("unknown origin"). This affects ALL items.

The fallback logic in `FileUploadStep.tsx` is a secondary issue — it sets confidence to 50 when no item has confidence. But since the backend IS setting confidence (to 20), the fallback doesn't trigger. The real bug is entirely in `process-plan/index.ts`.

## Solution

Replace the ID-based matching in `calculateConfidence` with **name-based matching** using `collectItemNames` (which already exists but maps id→name). Instead, collect Agent 1 item names into a Set, then match Agent 3 items by name.

### Changes to `supabase/functions/process-plan/index.ts`

1. **Replace `collectItemIds` with `collectItemNameSet`** — gather all item names (lowercased) from Agent 1's output into a `Set<string>`.

2. **Update `calculateConfidence`** to accept `agent1Names: Set<string>` instead of `agent1Ids: Set<string>`:
   - Match items by name (lowercased) instead of by ID
   - `id.startsWith("new-")` check stays (for items Agent 3 explicitly added)
   - `!agent1Names.has(name)` replaces `!agent1Ids.has(id)` — "unknown origin" = 20
   - Rest of logic unchanged: rephrased=60, agent corrections=80, no corrections=100

3. **Add debug logging** — log each item's name, correction count, and calculated confidence.

4. **Update the caller** (~line 340-350) to pass the name set instead of the ID set.

### Changes to `src/components/steps/FileUploadStep.tsx`

5. **Tighten fallback logic** — only apply fallback if `pipelineComplete` is falsy in the response (indicating process-plan didn't run). Currently it checks if ANY item has confidence; change it to check the response metadata instead.

### Files

| File | Change |
|------|--------|
| `supabase/functions/process-plan/index.ts` | Switch from ID-based to name-based matching in `calculateConfidence`; add debug logs |
| `src/components/steps/FileUploadStep.tsx` | Tighten fallback to only apply when pipeline genuinely didn't run |

