

# Upgrade Agents 0+1 to Opus, Add Page Buffer for Classification Safety

## Changes

### 1. Upgrade model to Opus for Agents 0 and 1

Replace all instances of `"claude-sonnet-4-20250514"` with `"claude-opus-4-6"` in:

- **`supabase/functions/classify-document/index.ts`** — 4 occurrences (request body + 3 log entries)
- **`supabase/functions/extract-plan-vision/index.ts`** — 8 occurrences (3 extraction modes × request + log, plus standard path request + log)
- **`supabase/functions/extract-plan-items/index.ts`** — 4 occurrences (extraction + verification, each with request + log)

Do NOT change: `audit-completeness/index.ts`, `validate-hierarchy/index.ts`, `suggest-metrics/index.ts` — these stay on Sonnet.

### 2. Add page buffer after filtering in process-plan

**File: `supabase/functions/process-plan/index.ts`** (lines 652-656, after `planPages` is computed)

After computing `planPages` from `page_annotations`, add buffer logic before mapping to images:

- **Buffer 1**: Include the page immediately before the first plan page, unless it's classified as `cover`, `toc`, `vision_mission`, `blank`, or `appendix`
- **Buffer 2**: Fill gaps between consecutive plan pages — include intermediate pages unless they're in the safe-to-skip set

Use the `pageAnnotationsArr` already in scope to look up classifications. Replace `planPages` with the buffered set before mapping to images.

Add logging: `"Page buffer: added pages [X, Y] to filtered set. Final extraction pages: [...]"`

### Files Summary

| File | Change |
|------|--------|
| `supabase/functions/classify-document/index.ts` | Model → `claude-opus-4-6` (4 spots) |
| `supabase/functions/extract-plan-vision/index.ts` | Model → `claude-opus-4-6` (8 spots) |
| `supabase/functions/extract-plan-items/index.ts` | Model → `claude-opus-4-6` (4 spots) |
| `supabase/functions/process-plan/index.ts` | Add page buffer logic after line 650 |

### What NOT to change
- No prompt changes
- No changes to audit-completeness or validate-hierarchy (stay on Sonnet)
- No frontend changes
- No dedup, polling, or resume logic changes

