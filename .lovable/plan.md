

# Two UI/UX Fixes — Plan Structure Levels + Insight Box Layout Shift

## Fix 1: Plan Structure Level Management UX

**File: `src/components/steps/OrgProfileStep.tsx`**

Replace the "Number of levels" counter with +/- buttons (lines 244-267) with inline delete buttons per row and an "Add Level" button below.

- Remove `handleLevelCountChange` function (lines 76-84) and the `Minus`/`Plus` imports
- Each level row gets a trash/X button on the right that removes that specific level and re-indexes remaining levels
- Minimum 1 level — hide delete button when only 1 level remains
- Below the level list, add an "+ Add Level" button that appends a new level with an empty name field
- Keep "(highest)" on Level 1 and "(lowest)" on last level
- Max 7 levels stays enforced (hide Add Level at 7)
- Update `levelCount` state to stay in sync: `setLevelCount(newLength)` after add/remove

**Lines to replace**: 244-283 (the counter UI + level name list)

## Fix 2: Insight Box Fixed Height

**File: `src/components/steps/ProcessingOverlay.tsx`**

Add `min-h-[4.5rem]` to the insight container div (line 176) to prevent layout shift when tips rotate between 1 and 2 lines.

Change line 176 from:
```
<div className="rounded-lg bg-muted/50 border border-border p-4">
```
to:
```
<div className="rounded-lg bg-muted/50 border border-border p-4 min-h-[4.5rem]">
```

## Files Summary

| File | Change |
|------|--------|
| `src/components/steps/OrgProfileStep.tsx` | Replace +/- counter with per-row delete buttons + "Add Level" button |
| `src/components/steps/ProcessingOverlay.tsx` | Add `min-h-[4.5rem]` to insight container |

