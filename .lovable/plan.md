## Phase 4b.2 fix — Conflict UI bypass

### Problem
`tryDispatchHierarchical` returns `null` for both "fallback to legacy mapping" and "conflicts pending". The mount `useEffect` then tries to read `pendingConflicts` via a `setPendingConflicts(prev => …)` round-trip immediately after dispatch returns. Even though that pattern reads the latest state, control flow has already raced past in some paths, and more importantly the design conflates two semantically different null cases. When the bypass occurs, the screen lands on `mapping`, `MappingInterface` initializes with `DEFAULT_LEVELS.slice(0,3)` ("Strategic Priority" / "Objective" / "Goal"), the legacy generator runs, and the 171 hierarchical items in `hierResultsBySheet` are discarded.

### Fix shape
Replace the `null` return with a discriminated union so the caller can branch synchronously without touching React state mid-decision. Then add a small belt-and-braces `useEffect` that catches the case if a future code path ever populates `pendingConflicts` while `phase !== 'level-conflict'`.

### Changes

**1. `src/components/steps/SpreadsheetImportStep.tsx` — `tryDispatchHierarchical` return type**

New return contract:
```ts
type DispatchResult =
  | { kind: 'completed'; payload: { items: PlanItem[]; personMappings: PersonMapping[]; levels: PlanLevel[]; sheetNames: string[] } }
  | { kind: 'conflicts'; conflicts: PendingConflict[]; perSheet: Record<string, {...}>; sheetNames: string[] }
  | { kind: 'fallback'; reason: string };
```

- Remove all `setHierResultsBySheet` / `setHierSheetOrder` / `setPendingConflicts` calls from inside `tryDispatchHierarchical`. The function becomes a pure decision producer (still does its parsing + diagnostic logging).
- Return `{ kind: 'fallback', reason }` for: missing `layout_classification`, empty/error classification, mixed routing.
- Return `{ kind: 'conflicts', conflicts, perSheet, sheetNames }` when `conflicts.length > 0`.
- Return `{ kind: 'completed', payload }` when fully resolved.

**2. `src/components/steps/SpreadsheetImportStep.tsx` — mount `useEffect` caller (lines 165–187)**

Replace the `if (dispatched)` / `setPendingConflicts(prev => …)` block with a synchronous switch on `result.kind`:
```ts
const result = await tryDispatchHierarchical({...});
switch (result.kind) {
  case 'completed':
    await persistAndComplete(result.payload);
    return;
  case 'conflicts':
    setHierResultsBySheet(result.perSheet);
    setHierSheetOrder(result.sheetNames);
    setPendingConflicts(result.conflicts);
    setPhase('level-conflict');
    return;
  case 'fallback':
    // fall through to existing mapping/detection branch below
    break;
}
```
This guarantees `setPhase('level-conflict')` is the unconditional, synchronous next call when conflicts exist — no state-read race possible.

**3. `src/components/steps/SpreadsheetImportStep.tsx` — defensive guard `useEffect`**

Add a small effect (cheap, ~5 lines) that runs whenever `pendingConflicts` or `phase` changes:
```ts
useEffect(() => {
  if (pendingConflicts.length > 0 && phase !== 'level-conflict' && phase !== 'generating') {
    console.warn('[ssphase4b] guard: pendingConflicts present but phase=', phase, '— forcing level-conflict');
    setPhase('level-conflict');
  }
}, [pendingConflicts, phase]);
```
Protects against any future code path that might populate conflicts without setting phase.

**4. No changes to** `MappingInterface`, `LevelConflictBlock`, `parseHierarchicalColumns`, `SheetPickerStep`, `FileUploadStep`, or `Index.tsx`. Phase 4b.2 wiring elsewhere is correct and validated.

### Why this fixes all three reported bugs
- **Bug 1 (conflict UI bypassed):** Synchronous switch on the discriminated union makes the conflict path unmissable. No state round-trip, no race.
- **Bugs 2 & 3 ("Strategic Priority"/"Objective"/"Goal" leakage):** Those labels appeared only because the bypass dropped users into `mapping` with `DEFAULT_LEVELS.slice(0, 3)`. Once the conflict screen renders correctly, the hierarchical path completes via `finalizeFromHierSnapshots → persistAndComplete` and the legacy mapping default levels never enter the picture. If the user explicitly chooses "Let me reconfigure", they intentionally enter the legacy mapping flow — that's still correct behavior per spec.

### Validation after deploy (Tulane, 5 user levels: Pillar/Goal/Objective/Strategy/Tactic)
1. Conflict UI appears after sheet picker; default radio = "Use my 5 levels"; "Use AI's 4 levels" and "Let me reconfigure" both selectable.
2. "Use my 5 levels" → Apply → `reparsed` log fires; item count visible; final import uses 5-level hierarchy with user names.
3. "Use AI's 4 levels" → Apply → `reparsed` log fires; item count = 171 (matches non-user-level baseline); final import uses classifier levels.
4. "Let me reconfigure" → Apply → existing toggle mapping UI appears (intentional fall-through).
5. No "Strategic Priority" / "Objective" / "Goal" labels in the final imported items on any hierarchical path (1, 2, 3).
6. Diagnostic confirmation: every conflict-path session has `level-conflict { detected: true }` followed by `reparsed { trigger: 'user-apply', choice }` for the user's selection.

### Out of scope
- Pattern A enhancements (4c)
- Multi-sheet conflict queueing edge cases beyond what already works
- Persisting overrides across sessions
