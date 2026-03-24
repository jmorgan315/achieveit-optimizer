
# Upgrade Agents 0+1 to Opus, Add Page Buffer — IMPLEMENTED

## What was done

### 1. Model upgrade to Claude Opus 4.6
- `classify-document/index.ts`: 4 references → `claude-opus-4-6`
- `extract-plan-vision/index.ts`: 6 references → `claude-opus-4-6`
- `extract-plan-items/index.ts`: 4 references → `claude-opus-4-6`
- `audit-completeness` and `validate-hierarchy` remain on `claude-sonnet-4-20250514`

### 2. Page buffer for classification safety
Added buffer logic in `process-plan/index.ts` after Agent 0 filtering:
- **Buffer 1**: Includes the page immediately before the first plan page (unless classified as cover/toc/vision_mission/blank/appendix)
- **Buffer 2**: Fills gaps between consecutive plan pages with intermediate pages (same skip rules)
- Logs buffered pages for observability

## Files changed
| File | Change |
|------|--------|
| `supabase/functions/classify-document/index.ts` | Model → `claude-opus-4-6` |
| `supabase/functions/extract-plan-vision/index.ts` | Model → `claude-opus-4-6` |
| `supabase/functions/extract-plan-items/index.ts` | Model → `claude-opus-4-6` |
| `supabase/functions/process-plan/index.ts` | Page buffer logic after Agent 0 filtering |
