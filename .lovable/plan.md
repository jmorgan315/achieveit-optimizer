
# Phase 4d.1.1 — Pattern A confirmation routing (regression fix)

## Diagnosis (confirmed)

The dispatcher only checks `kind`, not `pattern`. Routing in `SpreadsheetImportStep.tsx`:

- `decideDispatch()` (line 75) returns `{ kind: 'generic' }` for Pattern A by design — only B/C are hierarchical.
- `tryDispatchHierarchical()` rejects any sheet set that isn't 100% hierarchical (line 326–334) → returns `{ kind: 'fallback', reason: 'mixed routing' }` (or `pattern-a` per-sheet).
- The caller (line 206) treats `fallback` uniformly: `setPhase('mapping')` — bypassing `MappingConfirmation` entirely.

So Pattern A with valid classifier output (≥80% confidence) lands directly in the legacy toggle UI. The "Strategic Priority / Objective / Goal" leak is `DEFAULT_LEVELS.slice(0,3)` (line 102) being persisted as-is when the user clicks Apply on the legacy screen, never having seen the AI's detected section markers.

This contradicts the master plan: when `layout_classification` is present, `MappingConfirmation` should render first regardless of pattern.

## Proposed architecture

### Dispatch result: add a third success branch

Extend `DispatchResult` with a `'generic-confirm'` branch carrying the Pattern A preview:

```text
DispatchResult =
  | { kind: 'completed';       perSheet, sheetNames, clsBySheetName, parserDirectives, payload }   // B/C happy path
  | { kind: 'conflicts';       perSheet, sheetNames, clsBySheetName, parserDirectives, conflicts } // B/C with conflict
  | { kind: 'generic-confirm'; sheetNames, clsBySheetName, parserDirectives,                       // NEW — Pattern A
                               genericPreview: { itemsBySheet: Record<string, PlanItem[]>,
                                                 personMappingsBySheet: Record<string, PersonMapping[]>,
                                                 mergedDetection, columnMappings, sectionMapping, levels } }
  | { kind: 'fallback'; reason }                                                                    // truly no classification
```

`tryDispatchHierarchical` mixed/generic branch becomes:

1. If every selected sheet's `decision.kind === 'generic'` AND a usable classifier output exists for at least one selected sheet → run the existing Pattern A pipeline upfront:
   - Build `merged = mergeSheetDetections(selectedDetections)` (same as legacy `handleApplyMapping`).
   - Compute default `columnMappings` / `sectionMapping` / `levels` exactly as the post-detect block does today (lines 154–166 / 102).
   - Call `generatePlanItems(merged, { columnMappings, sectionMapping, measurementMode: default, levels })` to produce the preview items + person mappings.
   - Return `kind: 'generic-confirm'` with the preview payload and the same `clsBySheetName` / `parserDirectives` map already fetched.
2. If sheets are a true mix of hierarchical + generic, keep returning `fallback` (rare; current behavior).
3. If no classifier data at all → `fallback` (unchanged).

### Caller wiring

In the `if (validPreselected …)` block:

- `kind: 'completed' | 'conflicts'` → unchanged, stash `hierResultsBySheet` etc., `setPhase('mapping-confirmation')`.
- `kind: 'generic-confirm'` (new) → stash `clsBySheetName`, `parserDirectives`, the generic preview into a new ref/state `genericPreview`, set `hierSheetOrder` from `result.sheetNames`, leave `hierResultsBySheet` empty, `setPhase('mapping-confirmation')`. Log `mapping-confirmation-shown` with `pattern: 'A'`.
- `kind: 'fallback'` → unchanged (legacy detection/mapping flow).

### MappingConfirmation render

The render block at line 723 builds `sheetSummaries` from `hierResultsBySheet`. Update it to also read from `genericPreview`:

For each `name` in `hierSheetOrder`:
- If `hierResultsBySheet[name]` exists → use it (B/C path, unchanged).
- Else if `genericPreview` exists → derive:
  - `resolvedLevels`: `cls.structure.implied_levels` (or `section_marker_pattern.levels` — whichever the classifier populates for Pattern A; fall back to `[]`).
  - `itemCount`: `genericPreview.itemsBySheet[name]?.length ?? 0`.
  - `nameSourceColumn`: existing `headerRow[nameColIdx]` lookup already works.
  - `attributeMappings`: existing header walk already works (it uses `parsedSheet`/`detSheet`).
  - `conflict`: always undefined for Pattern A (no level conflict concept).

No new rendering primitives needed — the existing card layout fits Pattern A.

### Continue / Adjust on Pattern A

- **Continue (`onAccept`)**: branch on whether `genericPreview` is set. If yes → call a new `finalizeFromGenericPreview()` that does exactly what `handleApplyMapping` does today (persist `step_results`, mark session completed, call `onComplete`) using the pre-computed items/personMappings/levels/mergedDetection from `genericPreview` — no re-parse. If no → existing `finalizeFromHierSnapshots()`.
- **Adjust (`onAdjust`)**: unchanged — `setPhase('mapping')` routes Pattern A to the legacy `MappingInterface` (correct behavior; `LevelMappingInterface` is B/C-only and ships in 4d.2). Pre-set `columnMappings` / `sectionMapping` / `levels` from `genericPreview` so the toggle UI opens with the AI's defaults instead of `DEFAULT_LEVELS.slice(0,3)`.

### Side benefit

This also fixes the level-defaults leak on Pattern A's "Adjust" path: by seeding `levels` from the classifier's `implied_levels` before rendering legacy `MappingInterface`, the user no longer sees "Strategic Priority / Objective / Goal" defaults regardless of whether they Continue or Adjust.

## Files to change

| File | Change |
|---|---|
| `src/components/steps/SpreadsheetImportStep.tsx` | Add `'generic-confirm'` to `DispatchResult`; in `tryDispatchHierarchical`, replace the unconditional `mixed routing → fallback` with the Pattern A preview branch; add `genericPreview` state; add `finalizeFromGenericPreview`; update `mapping-confirmation` render to consume `genericPreview`; seed `levels`/`columnMappings`/`sectionMapping` from preview before `setPhase('mapping')` in `onAdjust` |
| `src/components/spreadsheet/MappingConfirmation.tsx` | No structural change — already renders from `SheetSummary` shape. Pattern A badge styling already supported (line ~50) |

No changes to: classifier, picker, parser core, edge functions, DB, `Index.tsx`, PDF path.

## Diagnostic logging additions

- `dispatcher.dispatch` outcome `generic-confirm` (replaces `fallback / mixed-routing` on the Pattern A path) with `{ pattern, confidence, itemCount }` per sheet.
- `ssphase4d.mapping-confirmation-shown` already includes pattern; will now show `'A'` for these sessions — no code change needed.
- New `ssphase4d.accept-clicked` payload field `source: 'hierarchical' | 'generic'` so we can distinguish post-deploy.
- New `ssphase4d.adjust-clicked` payload field `levelsSeededFrom: 'classifier' | 'defaults'` to confirm the leak is closed.

## No-hardcoding guarantees

- Pattern A entry is gated on `cls.pattern` value + presence of classifier output, never on filename/sheet-name.
- All defaults (column mappings, section mapping, levels) derive from runtime classifier + header analysis already in the codebase.
- No new string allowlists.

## Validation scenarios

1. DRAFT Initiative 1 (Pattern A, 91%) → `MappingConfirmation` renders with Pattern A badge, attribute list, item count from `generatePlanItems`. Continue persists same items legacy mapping would have produced. No "Strategic Priority" leak.
2. Astera (Pattern A, 95–97%) → same; multi-sheet summary cards.
3. Tulane (Pattern C with conflict) → unchanged behavior, still hits `'conflicts'` branch.
4. Santa Cruz (Pattern B) → unchanged.
5. Pattern A user clicks **Adjust** → legacy `MappingInterface` opens with classifier-derived levels seeded; user sees AI defaults, not `Strategic Priority/Objective/Goal`.
6. Truly mixed selection (one Pattern B + one Pattern A in same import) → still falls back to legacy flow (rare; out of scope).
7. Legacy session with no `layout_classification` → unchanged fallback to legacy mapping.
8. Hard refresh between attempts.

## Out of scope (still 4d.2)

- `LevelMappingInterface` for B/C reconfigure.
- `parseHierarchicalColumns(userLevelColumnIndices)` parameter.
- Predicate Apply translation.
- Replacing legacy `MappingInterface` for Pattern A's Adjust path (it's the right tool for A; only B/C need a new reconfigure UI).
