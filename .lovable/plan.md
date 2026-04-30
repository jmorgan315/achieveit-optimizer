# Fix: Importer detection screen still shown after picker Continue

## Root cause (found by code inspection, no logs needed)

The handoff between picker and importer has an "all selected ⇒ undefined" shortcut that the importer interprets as "no preselection".

**`src/components/steps/SheetPickerStep.tsx` lines 289–295:**
```ts
const handleContinue = () => {
  const indices = [...selected].sort((a, b) => a - b);
  // If user picked everything (or classifier was unavailable), pass undefined so the
  // downstream importer falls back to its own default selection logic.
  if (indices.length === sheets!.length) onContinue(undefined);
  else onContinue(indices);
};
```

**`src/components/steps/SpreadsheetImportStep.tsx` lines 62–94:**
```ts
const validPreselected = preselectedSheetIndices?.filter(i => i >= 0 && i < det.sheets.length);
const initialIndices =
  validPreselected && validPreselected.length > 0
    ? validPreselected
    : getDefaultSheetSelection(det.sheets);
...
setPhase(validPreselected && validPreselected.length > 0 ? 'mapping' : 'detection');
```

For Astera (20/20 selected): picker calls `onContinue(undefined)` → `FileUploadStep` stores `undefined` into `preselectedSheetIndices` → importer's `validPreselected` is `undefined` → falls back to `getDefaultSheetSelection` (which only checks `Enterprise - All Pillars`) AND sets phase to `'detection'`.

That exactly matches the reported symptom (detection screen shown, only "Enterprise - All Pillars" pre-checked).

The previous "no code change needed" assertion missed this `undefined` shortcut.

## Fix

One-line behavioral change in `SheetPickerStep.tsx` `handleContinue`: always pass the explicit selected indices array. The "fall back to default selection" comment was a leftover from before the picker had its own UI — now that the user has explicitly confirmed every sheet in the picker, we should honor that choice in the importer instead of re-running default selection.

```ts
const handleContinue = () => {
  const indices = [...selected].sort((a, b) => a - b);
  onContinue(indices); // always explicit; never undefined
};
```

This makes both the importer's `validPreselected.length > 0` checks true:
- `initialIndices` = the user's actual picks (all 20 for Astera)
- `phase` = `'mapping'` (skips detection screen)

## Edge cases verified

- **Picker fallback (classifier failed / timed out)**: the picker's `selected` set is still populated by its own fallback selection logic before Continue is enabled, so `indices` won't be empty. If somehow it were empty, the existing importer guard (`length > 0`) sends it through `getDefaultSheetSelection` and `'detection'` phase — same graceful degradation as today.
- **Single sheet selected**: passes `[i]`, importer goes straight to mapping with that sheet — correct.
- **Subset selected**: already worked; unchanged.
- **All selected**: now works (the broken case).

## Issue 2 acknowledgment (no code change)

The "Detected sections" badges on the legacy detection screen aggregate across sheets while the picker shows them per-sheet. Both are correct views of the same underlying `detectStructure` data — no information is lost. Once the importer-skip fix above lands, users on the classifier-success path won't see the aggregated view at all, so this resolves itself. The aggregated view remains correct for the classifier-failure fallback path.

## Files to change

- `src/components/steps/SheetPickerStep.tsx` — simplify `handleContinue` (lines 289–295) to always pass the explicit indices array; remove the stale "pass undefined" comment.

## Verification (live test, Astera 20-sheet workbook)

1. Upload Astera file → picker enriches with item counts / sections / columns / merge note (already working).
2. Leave all 20 sheets checked → click Continue.
3. **Expected**: land directly on the mapping screen (no "Spreadsheet Analysis" / re-selection step).
4. Repeat with a subset (e.g., 5 sheets) → mapping screen shows those 5.
5. Repeat with classifier disabled (simulate via network throttle/error) → picker shows fallback banner, Continue still routes correctly.
