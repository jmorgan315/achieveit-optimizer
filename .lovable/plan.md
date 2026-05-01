# Phase 4d.1 — Mapping confirmation screen

Ship the confirmation-style mapping UI for classifier-success sheets and wire it into the existing dispatch flow. Defer LevelMappingInterface and directive Apply to 4d.2 per the sub-phase plan.

## Scope

In: new `MappingConfirmation.tsx`, new phase wiring, integration of the existing `LevelConflictBlock` inside it, informational directives display.

Out (deferred to 4d.2): `LevelMappingInterface`, `parseHierarchicalColumns(userLevelColumnIndices)` parameter, predicate Apply translation, any new edge function.

Not touched: classifier, picker, parser core, `Index.tsx`, PDF path, person mapping, downstream phases.

## Files

| File | Change |
|---|---|
| NEW `src/components/spreadsheet/MappingConfirmation.tsx` | Confirmation screen — AI Analysis card, optional conflict block, optional directives block, low-confidence banner, Continue / Adjust actions |
| `src/components/steps/SpreadsheetImportStep.tsx` | Add `'mapping-confirmation'` phase. Route the post-dispatch happy path and the conflict-resolved path through it. Keep `'level-conflict'` and `'mapping'` intact as fallbacks |
| `src/components/spreadsheet/MappingInterface.tsx` | No structural change. `LevelConflictBlock` continues to be exported (already is) for reuse |

No DB, edge function, parser, or classifier changes in 4d.1.

## What MappingConfirmation renders

Props:
- `sheetSummaries`: ordered array of `{ sheetName, pattern, confidence, resolvedLevels, itemCount, nameSourceColumn, attributeMappings, directives, conflict? }`
- `onAccept()`, `onAdjust(sheetName)`, `onApplyConflict(sheetName, choice)`, `conflictBusy`

Sections per sheet (collapsible card if multiple sheets, single card otherwise):

1. **Low-confidence banner** (only when `confidence < 80`) — yellow alert: "AI is less certain about this sheet — please review carefully before continuing."
2. **AI Analysis card**
   - Pattern badge (color matches picker: A/B/C)
   - `confidence%` text
   - Detected levels chain rendered as `Goal → Objective → Strategy → Tactic`
   - Item count from the actual parse result already in `hierResultsBySheet`
   - Name source column line
   - Attribute mapping list — bullet rows derived from `getDefaultColumnRole` results on non-hierarchy columns. `✓` if mapped to a non-skip role with the role label; `·` and "Skip" otherwise
3. **Conflict block** (only when `conflict` present) — inline `<LevelConflictBlock>` with the existing props; on `onApply` calls `onApplyConflict(sheetName, choice)`. Replaces the standalone `'level-conflict'` phase render
4. **Directives block** (only when `directives.exclude_row_predicates.length > 0` OR `directives.custom_notes` non-empty)
   - Title: "Suggestions from your notes"
   - For each predicate: row text + `[Apply this filter]` (disabled, tooltip "Coming soon — 4d.2") + `[Ignore]` (active; clicking marks it visually dismissed). Default state = neither chosen, both visible
   - For `custom_notes`: render verbatim under "Notes from your hints", no controls
5. **Action buttons** at the bottom of the screen (not per-card):
   - `[Looks good — Continue]` primary green — calls `onAccept()`
   - `[Let me adjust]` secondary — calls `onAdjust(firstSheetName)`. In 4d.1 this routes to the existing `MappingInterface` fallback (the current `'mapping'` phase) for any pattern. 4d.2 will swap in `LevelMappingInterface` for B/C

The Continue button is disabled while any unresolved conflict block is on screen — the user must apply a conflict choice first. (Conflict apply re-runs the parse for that sheet, removes it from `pendingConflicts`, and updates the summary in place.)

## SpreadsheetImportStep wiring

Add to the `Phase` union: `'mapping-confirmation'`.

After `tryDispatchHierarchical` resolves:

| Result | Phase set |
|---|---|
| `kind: 'completed'` with no conflicts AND classifier output present | `'mapping-confirmation'` (new) — populated from `hierResultsBySheet` and the classifier sheet entries; `pendingConflicts` is empty |
| `kind: 'conflicts'` | `'mapping-confirmation'` (new) — `pendingConflicts` populated, conflict blocks render inside the screen for each conflicted sheet |
| `kind: 'fallback'` | unchanged — falls through to existing `'detection'` / `'mapping'` flow |

The standalone `'level-conflict'` phase is **kept** but no longer reached on the happy path; the belt-and-braces guard at lines 198–203 stays as defense-in-depth and now redirects to `'mapping-confirmation'` instead. (Old standalone block can be left in place for now and removed in cleanup; not worth churning the file for it.)

`handleApplyLevelChoice` already updates `hierResultsBySheet` and pops `pendingConflicts`. We extend it: when `pendingConflicts` empties on the confirmation screen, **do not auto-finalize** — stay on the confirmation screen so the user can review and click Continue. The microtask `finalizeFromHierSnapshots()` call moves to the new `onAccept` handler.

Continue (`onAccept`) calls `finalizeFromHierSnapshots()` exactly as today.

Adjust (`onAdjust`) sets `phase = 'mapping'`. The legacy `MappingInterface` then renders against the same `selectedSheetIndices` / `columnMappings` already set during the post-detect block. This preserves Pattern A "Let me adjust" behavior and provides a working escape hatch for B/C in 4d.1 (full B/C reconfigure UX lands in 4d.2).

## Building the per-sheet summary

Inside `SpreadsheetImportStep`, after dispatch settles, build a `sheetSummaries` array:

- Source ordering: `hierSheetOrder`
- For each sheet name `n`:
  - Pull `cls = clsBySheetName.get(n)` from the layout_classification fetched in `tryDispatchHierarchical` — store the map on a ref so the render can read it without re-fetching
  - `pattern = cls.pattern`, `confidence = cls.confidence`
  - `resolvedLevels = hierResultsBySheet[n].resolvedLevels`
  - `itemCount = hierResultsBySheet[n].items.length`
  - `nameSourceColumn`: header text at `cls.structure.name_column_index`, fall back to `resolvedLevels[resolvedLevels.length - 1]`
  - `attributeMappings`: map non-hierarchy headers using `getDefaultColumnRole` (already imported); each entry = `{ header, role, included: role !== 'skip' }`
  - `directives`: pulled from `cls.parser_directives` (workbook-level, applied once at top of the screen, not per-sheet — adjust shape accordingly)
  - `conflict`: matching entry from `pendingConflicts` if any

Cache the layout_classification fetch result on a `useRef` so it's available at render without re-querying. The fetch already happens once inside `tryDispatchHierarchical`; expose it via the discriminated-union return (extend `DispatchResult.kind === 'conflicts' | 'completed'` to include `clsBySheetName` and `parserDirectives`).

## Diagnostic logging (parser_diagnostics)

New `parser_name = 'ssphase4d'` entries:

- `mapping-confirmation-shown` — `{ sheets: [{sheet, pattern, confidence}], hasConflict, hasDirectives }` logged once when phase enters `'mapping-confirmation'`
- `adjust-clicked` — `{ sheet, pattern, target: 'mapping-interface' }` (in 4d.1 always `'mapping-interface'`)
- `accept-clicked` — `{ sheets: [...], totalItems }`
- `directive-ignored` — `{ predicate }` when user dismisses a predicate
- `directive-apply-attempted-disabled` — `{ predicate }` if user hovers/clicks the disabled Apply button (for product feedback on demand)

Use the existing `logParserDiagnostic` helper (`src/utils/parserDiagnostics.ts`).

## No-hardcoding guarantees

- Pattern badge color and label keyed on `cls.pattern` value, not file or sheet names
- Item counts read from runtime parse output, not hard-coded thresholds
- Attribute mappings produced by `getDefaultColumnRole` against runtime headers; no string allowlists in the new file
- Directives rendered verbatim from `parser_directives.exclude_row_predicates` and `custom_notes`
- No filename, sheet-name, or header-text checks anywhere in `MappingConfirmation`

## Validation scenarios after 4d.1 ships

1. Pattern A sheet with classifier confidence ≥80 → confirmation screen shows pattern A badge, attribute list, item count; **Continue** finalizes; **Adjust** lands on existing toggle UI pre-filled
2. Pattern B sheet (e.g., Santa Cruz–style hierarchy) ≥80 → confirmation shows hierarchy chain, item count, **Continue** works
3. Pattern C sheet (Tulane post-stem-fold) → confirmation shows `Goal → Objective → Strategy → Tactic` and the actual item count; **Continue** works
4. Sheet with classifier confidence <80 → yellow banner appears above AI Analysis card; rest functional
5. Sheet with `parser_directives.exclude_row_predicates` non-empty → directives block renders with disabled Apply + active Ignore; tooltip explains 4d.2
6. Conflict from 4b.2 → conflict block renders **inside** the confirmation screen (no standalone level-conflict phase on happy path); Continue is disabled until conflict is resolved; after resolution, item count updates in place and Continue enables
7. Legacy session (no `layout_classification`) → falls through to existing `MappingInterface`, no regression
8. Hard-refresh between attempts to flush Vite cache

## Out of scope (4d.2)

- `LevelMappingInterface` for Pattern B/C reconfigure
- `parseHierarchicalColumns` `userLevelColumnIndices` parameter
- Predicate Apply translation (keyword / column-equals / starts-with)
- Replacing legacy `MappingInterface` for B/C "Let me adjust" — currently routes there as a working but imperfect escape hatch

After 4d.1 validates, I'll write a 4d.2 plan covering LevelMappingInterface and the predicate filter helper.
