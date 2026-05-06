## Goal

Ship Phase 4d.2.a (LevelMappingInterface) end-to-end as the first validated chunk. Keep 4d.2.b and 4d.2.c plumbing in place (already written) but stub the Apply buttons with "Coming soon" tooltips so the directives surface is informational only. Do not remove `applyRowPredicate.ts`, `CellTransformation` types, parser support, or classifier schema/prompt extensions — they stay inert until wired.

## Scope (this chunk only)

1. Wire `'level-mapping'` phase render block in `SpreadsheetImportStep.tsx`.
2. Branch `onAdjust` by classifier pattern: Pattern A → legacy `MappingInterface` (existing path); Pattern B/C → set `levelMappingTarget` and `setPhase('level-mapping')`.
3. In `MappingConfirmation.tsx`, render predicate rows and cell-rule rows informationally with Apply buttons **disabled** + tooltip "Coming soon — 4d.2.b" / "Coming soon — 4d.2.c". Undo/Ignore also disabled to avoid half-wired state. Active-state branches (✓ Applied / Undo) become unreachable in this chunk and can be left in source but won't render because `activeOnSheets` will always be empty.
4. Plumb `directives.predicateRows` and `directives.cellRuleRows` through `SpreadsheetImportStep` so predicates and cell rules show up. Each row's `activeOnSheets: []`, `removedCount: 0`, `cellsTransformed: 0` (informational only).

## Explicitly NOT in this chunk

- Calling `handleApplyPredicate` / `handleUndoPredicate` from the UI.
- Calling `handleApplyCellRule` / `handleUndoCellRule` from the UI.
- Removing existing handlers, `reparseAndRefold`, `applyRowPredicate.ts`, `CellTransformation` parser support, or classifier `cell_transformations` schema/prompt — all stays as dead-but-correct code.

## Files to change

### `src/components/spreadsheet/MappingConfirmation.tsx`

- Add a new optional prop `directivesEnabled?: { predicates: boolean; cellRules: boolean }` (default `{ predicates: false, cellRules: false }`).
- For each predicate row: when `directivesEnabled.predicates === false`, render Apply as `<Button disabled>` wrapped in a `<Tooltip>` with content "Coming soon — 4d.2.b". Ignore button also disabled. Skip the active/dismissed visual states.
- For each cell-rule row: same pattern with tooltip "Coming soon — 4d.2.c".
- Keep existing handler props optional; do not invoke them when disabled.
- The `onAttemptApplyDirective` prop already referenced from `SpreadsheetImportStep` (currently typo'd as a non-existent prop in the tsx) — either remove that callsite or accept it as a no-op prop. **Decision:** drop `onAttemptApplyDirective` prop entirely, log "coming-soon-clicked" instead is unnecessary because buttons are disabled (no click).

### `src/components/steps/SpreadsheetImportStep.tsx`

- **Render block — add `level-mapping` phase** (before the final `return null`):
  ```tsx
  if (phase === 'level-mapping' && levelMappingTarget) {
    return (
      <LevelMappingInterface
        sheetName={levelMappingTarget.sheetName}
        parsedSheet={levelMappingTarget.parsedSheet}
        classification={levelMappingTarget.classification}
        initialLevels={levelMappingTarget.initialLevels}
        initialColumnIndices={levelMappingTarget.initialColumnIndices}
        cellTransformations={activeCellTxBySheet[levelMappingTarget.sheetName] ?? []}
        sessionId={sessionId}
        onApply={handleApplyLevelMapping}
        onCancel={() => { setLevelMappingTarget(null); setPhase('mapping-confirmation'); }}
      />
    );
  }
  ```

- **Rewrite `onAdjust`** in the `mapping-confirmation` render to branch by pattern:
  ```tsx
  onAdjust={(sheetName) => {
    const cls = clsBySheetName[sheetName];
    const pattern = String(cls?.pattern ?? '').toUpperCase();
    void logParserDiagnostic(sessionId, 'ssphase4d', 'adjust-clicked', {
      sheet: sheetName, pattern, target: pattern === 'B' || pattern === 'C' ? 'level-mapping' : 'mapping-interface',
    });
    if ((pattern === 'B' || pattern === 'C') && cls) {
      const hier = hierResultsBySheet[sheetName];
      const parsedSheet = hier?.parsedSheet ?? detection?.sheets.find(s => s.sheet.name === sheetName)?.sheet;
      if (!parsedSheet) { setPendingConflicts([]); setPhase('mapping'); return; }
      const initialLevels = hier?.resolvedLevels ?? cls.structure?.implied_levels ?? [];
      const initialColumnIndices = hier?.resolvedColumnIndices ?? initialLevels.map((_, i) => i);
      setLevelMappingTarget({ sheetName, classification: cls, parsedSheet, initialLevels, initialColumnIndices });
      setPhase('level-mapping');
      return;
    }
    // Pattern A (and any unknown): legacy mapping flow — unchanged.
    setPendingConflicts([]);
    setPhase('mapping');
  }}
  ```

- **Build `directivesSummary` with predicate + cell-rule rows** so they show informationally. All `activeOnSheets`/`removedCount`/`cellsTransformed` are 0 in this chunk:
  ```tsx
  const predicateRows: PredicateRow[] = (parserDirectives?.exclude_row_predicates ?? []).map(p => ({
    predicate: p,
    parsed: parsePredicate(p, /* headers from first hier sheet, or [] */ []),
    activeOnSheets: [],
    removedCount: 0,
  }));
  const cellRuleRows: CellRuleRow[] = (parserDirectives?.cell_transformations ?? []).map(rule => ({
    rule,
    description: describeCellRule(rule), // small helper: "Take first delimited value before ';' for level X" etc.
    activeOnSheets: [],
    cellsTransformed: 0,
  }));
  const directivesSummary: DirectivesSummary | undefined =
    (predicateRows.length || cellRuleRows.length)
      ? { excludePredicates: parserDirectives?.exclude_row_predicates ?? [], predicateRows, cellRuleRows }
      : undefined;
  ```

- Pass `directivesEnabled={{ predicates: false, cellRules: false }}` to `MappingConfirmation` and **drop the `onAttemptApplyDirective` prop** (it doesn't exist on the component).

- Leave `handleApplyLevelMapping`, `handleApplyPredicate`, `handleUndoPredicate`, `handleApplyCellRule`, `handleUndoCellRule`, `reparseAndRefold` in place. The predicate/cell-rule handlers are simply not passed as props to `MappingConfirmation` in this chunk.

### Files NOT changed

- `src/components/spreadsheet/LevelMappingInterface.tsx` — already complete.
- `src/utils/parsers/parseHierarchicalColumns.ts` — already accepts `userLevelColumnIndices` and `cellTransformations`.
- `src/utils/parsers/applyRowPredicate.ts` — kept as inert utility for 4d.2.b.
- `supabase/functions/classify-spreadsheet-layout/index.ts` — schema/prompt extensions for `cell_transformations` already deployed; harmless without UI wiring.

## Validation scenarios after this ships

1. **Pattern A sheet (Test 4 / Test 6)**: `MappingConfirmation` shows; "Let me adjust" routes to legacy `MappingInterface` (no regression).
2. **Pattern B/C sheet**: "Let me adjust" routes to `LevelMappingInterface`. Map levels → live preview updates → Apply Mapping returns to `mapping-confirmation` with new resolved levels and item count. Cancel returns without changes.
3. **Mixed B/C + A**: each sheet's "Let me adjust" routes to its own UI based on its classifier pattern.
4. **Sheets with directives**: predicate and cell-rule rows render with disabled Apply buttons + "Coming soon" tooltips. No state mutation when hovered/clicked.
5. **No directives**: directives card hidden entirely.
6. **Continue (Looks good)**: still finalizes from hier snapshots / generic preview as before.

## Diagnostic logs expected

- `ssphase4d / adjust-clicked` with `target: 'level-mapping' | 'mapping-interface'` based on pattern.
- `ssphase4d2a / level-mapping-applied` on Apply Mapping with itemsBefore/itemsAfter.

## Report-back format

After shipping:
- Files changed (only the two above).
- Confirmation that no test-file-specific hardcoding was introduced.
- Diagnostic log examples from one Pattern B/C upload going through level-mapping.
- Confirmation that 4d.2.b/4d.2.c handlers + utilities remain in source, unwired.
