

## Raise Dedup Matching Thresholds

Two numeric changes in `supabase/functions/process-plan/index.ts`:

### Changes in `isDuplicate()` function (~line 364-367)

1. **`starts_with` prefix**: Change `40` → `50` (line 364, and the matching check in the skipped-tracking block at line 424)
2. **`word_overlap` threshold**: Change `0.70` → `0.95` (line 367, and the matching check at line 425)

Also update the `reason` string from `"starts_with_40"` to `"starts_with_50"` for accuracy.

### Files modified

| File | Change |
|------|--------|
| `supabase/functions/process-plan/index.ts` | Change prefix 40→50 and overlap 0.70→0.95 in `isDuplicate()` and the skipped-tracking block |

### Deployment

Edge function will be redeployed automatically after the code change.

