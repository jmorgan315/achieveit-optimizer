

# Fix Dedup Preference, Add Dedup Admin Log, Clean Up Timeline Labels

## Changes

### 1. Fix dedup preference logic + word overlap
**File: `supabase/functions/process-plan/index.ts`**

**Simplify winner selection** (lines 329-342): Remove the `summaryPages` detection entirely. Replace with a simple rule: always prefer higher `source_page`, tie-break by longer name. Remove the `pageAnnotations` parameter from `deduplicateItems` since it's no longer needed for dedup preference.

**Fix word overlap false positives** (line 264): Change `wordSet` to filter out words with length ≤ 3 (currently filters ≤ 2). This excludes common short words like "and", "to", "for", "all" that inflate overlap scores between genuinely different items.

### 2. Add dedup summary to admin log
**File: `supabase/functions/process-plan/index.ts`** (after dedup call at ~line 727)

After `deduplicateItems` returns, call `logApiCall` with:
- `edge_function: "dedup-merge"`
- `step_label: "Step 1.5: Dedup & Merge"`
- `status: "success"`
- `request_payload`: `{ input_count, output_count, duplicates_removed }`
- `response_payload`: `{ removed_items: [{ removed_name, removed_page, kept_name, kept_page, match_reason }], final_items: [...names] }`
- `input_tokens: 0`, `output_tokens: 0`
- `duration_ms`: measured around the dedup call

To support this, modify `deduplicateItems` to return a structured result object (items + removal details) instead of just the filtered array.

### 3. Fix timeline labels
**File: `supabase/functions/process-plan/index.ts`** (line 590)
- Change `Step 2: Document Scan` → `Step 1: Plan Extraction`

**File: `supabase/functions/extract-plan-vision/index.ts`** (line 1024)
- Change fallback label from `Step 1: Document Scan` → `Step 1: Plan Extraction`

### Files Summary

| File | Change |
|------|--------|
| `supabase/functions/process-plan/index.ts` | Simplify dedup preference to higher page wins; fix word filter to >3 chars; return dedup details for logging; add `logApiCall` for dedup; fix batch label to "Step 1: Plan Extraction" |
| `supabase/functions/extract-plan-vision/index.ts` | Fix fallback label to "Step 1: Plan Extraction" |

