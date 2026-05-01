## Phase 4b.2 — Wire user-stated levels into hierarchical parser + add conflict UI

### Goal
Forward `processingConfig.planLevels` (already collected on Screen 2) down to `parseHierarchicalColumns` for Pattern B/C dispatches, surface an informational block on the picker when user levels exist, and add a conflict-resolution block on the mapping screen when user levels disagree with classifier `implied_levels`. No classifier or dispatcher changes.

### Files & changes

**1. `src/pages/Index.tsx`**
- At the existing `<FileUploadStep ... />` mount (~line 799), add prop:
  `userLevels={processingConfig?.planLevels && processingConfig.planLevels.length > 0 ? processingConfig.planLevels : undefined}`

**2. `src/components/steps/FileUploadStep.tsx`**
- Add `userLevels?: string[]` to `FileUploadStepProps` and destructure.
- Forward to `<SheetPickerStep userLevels={userLevels} ... />` and `<SpreadsheetImportStep userLevels={userLevels} ... />` at the existing mount sites (~lines 1072 and 1085).

**3. `src/components/steps/SheetPickerStep.tsx`**
- Add `userLevels?: string[]` to props.
- Render an informational block in the `<CardContent>` block, **above** the directives `Collapsible` (around line 335) and **below** the `needs_user_clarification` alert. Render only when `userLevels?.length > 0`.
- Use the existing `Alert` + `Info` icon styling (matches scope-variation banner aesthetic):
  ```
  ℹ️ You said this plan uses {N} levels: {Level1} → {Level2} → ... → {LevelN}.
     We'll match these against detected structures.
  ```
- Purely informational. No interaction.

**4. `src/components/steps/SpreadsheetImportStep.tsx`**
- Add `userLevels?: string[]` to `SpreadsheetImportStepProps` and destructure.
- Add per-sheet `effectiveLevelsBySheet` state: `Record<string /*sheetName*/, string[]>`. Initialize lazily — when a sheet first parses, set `effectiveLevelsBySheet[sheet.name] = userLevels?.length ? userLevels : (cls.structure?.implied_levels ?? [])`.
- In the `tryDispatchHierarchical` loop where `parseHierarchicalColumns(s.sheet, s.cls, undefined, args.sessionId)` is called (line 253), change the third arg to pass effective levels for that sheet, defaulting to `userLevels` when set.
- Add a `levels-source` diagnostic log per sheet right before invoking the parser:
  ```ts
  void logParserDiagnostic(sessionId, 'parseHierarchicalColumns', 'levels-source', {
    sheet: s.sheet.name,
    source: userLevels?.length ? 'user' : 'classifier',
    levels: effectiveLevels,
    classifierLevels: s.cls?.structure?.implied_levels ?? [],
  }, s.sheet.name);
  ```
- Add a `level-conflict` diagnostic per sheet using a `levelsEquivalent(a, b)` helper that compares lengths and `stemKey`-normalized values pairwise (duplicate the `stemKey` helper locally to avoid an import dependency, or export it from `parseHierarchicalColumns.ts`):
  ```ts
  void logParserDiagnostic(sessionId, 'parseHierarchicalColumns', 'level-conflict', {
    sheet: s.sheet.name,
    detected: !equivalent,
    reason: equivalent ? 'none' : (lenDiff ? 'length-mismatch' : 'name-mismatch'),
    userLevels, classifierLevels: implied,
  }, s.sheet.name);
  ```
- Track conflicts in state: `conflictsBySheet: Record<string, { userLevels: string[]; classifierLevels: string[] }>` populated only for sheets with both arrays non-empty AND not equivalent.
- For the mapping flow (the `phase === 'mapping'` branch at line 453), pass `conflictsBySheet`, `effectiveLevelsBySheet`, and an `onApplyLevelChoice(sheetName, choice)` callback into `<MappingInterface ... />`.
- `onApplyLevelChoice` updates `effectiveLevelsBySheet[sheetName]`, re-runs `parseHierarchicalColumns` for that sheet, updates the displayed item count + sections, and logs:
  ```ts
  void logParserDiagnostic(sessionId, 'parseHierarchicalColumns', 'reparsed', {
    sheet, trigger: 'user-apply', newLevels, itemsBefore, itemsAfter,
  }, sheet);
  ```

**5. `src/components/spreadsheet/MappingInterface.tsx`**
- Add optional props: `userLevels?: string[]`, `classifierLevels?: string[]`, `onApplyLevelChoice?: (choice: 'user' | 'classifier' | 'reconfigure') => void`. (Conflict context is per-active-sheet — passed in from the parent.)
- Render a conflict block at the top of the mapping screen, **before** the existing column-mapping `Card`, only when both `userLevels?.length` and `classifierLevels?.length` are present and non-equivalent (parent gates this — child renders if props supplied).
- Use the existing `Alert` (or matching `Card`) styling. Layout:
  ```
  ✨ AI Analysis

  You said this plan uses {N} levels:
    {Level1} → ... → {LevelN}

  The AI detected {M} levels in this sheet:
    {ClassifierLevel1} → ... → {ClassifierLevelM}

  ⚠️ Mismatch detected. Which is correct?
  (•) Use my {N} levels   (default)
  ( ) Use AI's {M} levels
  ( ) Let me reconfigure
        [ Apply ]
  ```
- Use `RadioGroup`/`RadioGroupItem` (already in the project at `src/components/ui/radio-group.tsx`).
- "Apply" calls `onApplyLevelChoice(choice)`. "Let me reconfigure" falls through to the existing toggle UI (no new UI in 4b.2).

**6. `src/utils/parsers/parseHierarchicalColumns.ts`**
- No code change. Optional: export `stemKey` so the equivalence helper in `SpreadsheetImportStep` can reuse it (preferred over duplication).

### Equivalence rules
Two level arrays are equivalent iff:
1. Same length, AND
2. For every index i, `stemKey(a[i]) === stemKey(b[i])`

Length-mismatch → `reason: 'length-mismatch'`. Same length, position differs → `reason: 'name-mismatch'`.

### Resolution priority (already implemented in 4b.1)
1. `userLevels` (when non-empty)
2. `structure.implied_levels`
3. Ordinal column position fallback

When userLevels are passed, they replace `implied_levels` for column resolution. Stem-fold matching from 4b.1 still applies.

### Out of scope (deferred)
- Pattern A enhancements (4c)
- Mapping UI redesign beyond the conflict block (4d)
- Pattern D (4e)
- Persisting overrides across sessions
- Tulane 8.3.1.2 triple-duplication

### Validation scenarios to test
1. No user levels, Pattern C file → no conflict UI, no info block, parser uses classifier (current behavior).
2. User levels exactly matching classifier → info block on picker, no conflict UI, parser uses userLevels (same result).
3. User levels stem-fold equivalent (Goal vs Goals) → info block, no conflict UI.
4. User states 5 levels, classifier returned 4 → conflict UI on mapping, default = user, can switch.
5. User states different names (Pillar/Goal/Objective/Action vs Goal/Objective/Strategy/Tactic) → conflict UI, both visible, user picks.
6. Apply "Use my levels" → re-parse runs, item count updates, `reparsed` log fires.
7. Apply "Use AI's levels" → re-parse with classifier levels.
8. "Let me reconfigure" → falls through to existing toggle mapping UI.

### Report-back after ship
- Files changed list
- What's in 4b.2 vs deferred
- Diagnostic log examples (`levels-source`, `level-conflict`, `reparsed`) from one test upload
- Confirm zero test-file-specific hardcoding
- Validation scenario results
