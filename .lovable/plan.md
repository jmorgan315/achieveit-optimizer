## Scope

Single PR bundling three independent fixes inside Phase 4d.2.a. Directive Apply (4d.2.b/c) remains gated.

### 1. D2-1 — Per-sheet Adjust button

**File:** `src/components/spreadsheet/MappingConfirmation.tsx`

- Remove the global "Let me adjust" button from the bottom action bar (lines ~378–386). Bottom bar keeps only "Looks good — Continue".
- Add an "Adjust" button to each sheet's `<CardHeader>` (right-aligned, small/outline variant) that calls `onAdjust(summary.sheetName)`.
- No prop signature changes; `onAdjust` is already per-sheet.

### 2. Bug A — Force-swap on duplicate column pick

**File:** `src/components/spreadsheet/LevelMappingInterface.tsx` (`onValueChange` inside the level Select, ~line 153)

Replace the naive `next[i] = parseInt(v, 10)` with:

```ts
const newIdx = parseInt(v, 10);
const prevIdx = next[i];
next[i] = newIdx;
// Skip swap when picking the skip sentinel — multiple levels may share -1.
if (newIdx !== -1) {
  for (let j = 0; j < next.length; j++) {
    if (j !== i && next[j] === newIdx) next[j] = prevIdx;
  }
}
setLevelIndices(next);
```

This eliminates the Radix no-op symptom (selecting an already-used value silently failed) by guaranteeing the assignment always changes state. The `usedTwice` warning becomes a transient state only when no swap target exists (rare cascade case).

### 3. Bug B — Skip-level sentinel `-1`

**File:** `src/components/spreadsheet/LevelMappingInterface.tsx`

- Prepend `{ value: '-1', label: '(None — skip this level)' }` to `columnOptions` (~line 122).
- The `usedTwice` memo already filters `idx < 0` — unchanged.
- The `lowFillLevelWarnings` memo already excludes `idx < 0` — unchanged.
- The live preview already passes `levelIndices` straight through — unchanged.

**File:** `src/utils/parsers/parseHierarchicalColumns.ts` (`resolveHierarchyColumns`, ~lines 134–197)

When `userLevelColumnIndices` is supplied and length-matches `provided`, filter both arrays in lockstep so skipped slots disappear before tree construction:

```ts
if (userLevelColumnIndices && userLevelColumnIndices.length === provided.length) {
  const keptLevels: string[] = [];
  const keptIndices: number[] = [];
  for (let i = 0; i < provided.length; i++) {
    if (userLevelColumnIndices[i] >= 0) {
      keptLevels.push(provided[i]);
      keptIndices.push(userLevelColumnIndices[i]);
    }
  }
  return {
    resolvedLevels: keptLevels,
    resolvedColumnIndices: keptIndices,
    unresolvedLevels: [],
  };
}
```

**Diff scope check (parser):** Only the existing user-override branch is touched. Tree depth collapses naturally because the filtered array becomes the new `resolution.resolvedLevels` / `resolvedColumnIndices`, and every downstream loop (`lastNonBlank`, `parentByKey`, depth assignment) is already keyed off `resolution.resolvedColumnIndices.length`. Descendants keep parentage by walking the (now-shorter) resolved chain — no separate "skip past" logic required because the skipped levels never enter the chain at all.

The other resolution branch (header/ordinal matching when no user indices supplied) is untouched.

## Files changed

- `src/components/spreadsheet/MappingConfirmation.tsx` — move Adjust button; remove global Adjust.
- `src/components/spreadsheet/LevelMappingInterface.tsx` — force-swap; sentinel option.
- `src/utils/parsers/parseHierarchicalColumns.ts` — lockstep filter of `-1` indices in user-override branch only.

## Out of scope

- 4d.2.b / 4d.2.c wiring (still gated, tooltips unchanged).
- Bug C — pending user hard-refresh verification.
- Cascade-resolver UX for the rare case where force-swap can't find a clean target (warning Alert is sufficient).

## Validation after deploy

1. Multi-sheet upload → each sheet card has its own Adjust button routing per-pattern.
2. Tulane: change Level 4 from col 4 → col 3 directly; force-swap moves the previous Level-3 holder to col 4.
3. Tulane: set a middle level to "(None — skip this level)" → live preview re-renders with collapsed depth, descendants still parent correctly to the nearest non-skipped ancestor.
4. Continue from level-mapping → finalization unchanged.
