

# Fix Confidence Scoring + Add Show/Hide Toggle

## FIX 1: Smarter Confidence Scoring

### Problem
The `calculateConfidence` function in `process-plan/index.ts` (line 94-149) treats ALL corrections equally. When Agent 3 renames levels to match user-defined plan levels (e.g., "strategic_priority" → "Goal"), the item gets `confidence: 80` even though the extraction was correct.

### Solution

Update `calculateConfidence` in `supabase/functions/process-plan/index.ts` to classify correction types:

**No penalty (confidence stays 100):**
- Corrections of type `"relevel"` or `"renamed"` where the correction description indicates matching user-defined levels (check for patterns like "match user", "user-defined", "plan structure", "to match")

**Minor penalty (confidence 80):**
- `"moved"`, `"reordered"`, `"relevel"` corrections that are genuine structural fixes (not user-level mapping)

**Medium penalty (confidence 60):**
- `"renamed"` corrections that are genuine rephrasing fixes (already handled via `rephrasedIds`)

**Major penalty (confidence 40):**
- Items with IDs starting with `"new-"` (missing from Agent 1, added by pipeline)

**Low confidence (confidence 20):**
- Items with unknown origin (not in Agent 1's output, not new)

The key change is in the correction loop: before applying the 80-confidence penalty for "has corrections", filter out corrections that are user-level overrides. If ALL corrections on an item are user-level overrides, keep confidence at 100.

Also tag each correction string with a prefix like `[user-override]` or `[agent-correction]` so the frontend can distinguish them. The frontend `ConfidencePopover` and `hasDiscrepancy` logic will check for this prefix.

### Frontend changes

Update `ConfidencePopover.tsx`:
- In `hasDiscrepancy()`, ignore corrections containing `[user-override]`
- Display user-override corrections with softer styling (muted text, no warning icon)
- Change wording: "Level name updated to match your plan structure" instead of showing it as an error

Update `ConfidenceBanner.tsx` and filter logic in `PlanOptimizerStep.tsx`:
- Items with only user-override corrections should NOT count as "needs review"
- The `needsReviewCount` calculation (line 406) already uses `confidence < 80`, so the backend fix handles this automatically

## FIX 2: Show/Hide Confidence Toggle

Add a toggle in the toolbar area of `PlanOptimizerStep.tsx`, next to the view mode toggle.

### State
```typescript
const [showConfidence, setShowConfidence] = useState(() => {
  return localStorage.getItem('achieveit-show-confidence') === 'true';
});
```
Persist to `localStorage` on change. Default: `false` (OFF).

### When OFF, hide:
- `<SessionSummaryCard>` (line 431)
- `<ConfidenceBanner>` (line 432)
- "Needs Review" button (lines 448-457)
- Pass `showConfidence={false}` to `SortableTreeItem` → hide confidence dot and discrepancy badge
- Remove amber background highlight for low-confidence items

### When ON:
- Show everything as currently implemented

### UI placement
Add to the toolbar row (line 435-463), between the view mode toggle and the export button area:
```tsx
<div className="flex items-center gap-2">
  <Switch checked={showConfidence} onCheckedChange={...} />
  <Label>Show AI Confidence</Label>
</div>
```

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/process-plan/index.ts` | Update `calculateConfidence` to classify user-override vs agent corrections |
| `src/components/steps/PlanOptimizerStep.tsx` | Add `showConfidence` toggle with localStorage, conditionally render confidence UI |
| `src/components/plan-optimizer/SortableTreeItem.tsx` | Accept `showConfidence` prop, conditionally render dot/badge/highlight |
| `src/components/plan-optimizer/ConfidencePopover.tsx` | Softer styling for user-override corrections, update `hasDiscrepancy` |

