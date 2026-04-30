## Phase 4a polish: collapse picker + detection-screen duplication

Picker becomes the canonical sheet-selection screen. The importer already skips its detection phase when the picker passes pre-selected indices, so the existing `DetectionSummary` UI stays in place as graceful-degradation fallback for the no-classifier path.

### Change 1 — Enrich the picker with parser-side metadata

`src/components/steps/SheetPickerStep.tsx`: run `detectStructure` over the locally-parsed `ParsedSheet[]` (already produced by the existing `parseSpreadsheetFile` call). Memoize per-sheet `SheetDetection` keyed by sheet name. Render the new info **only on plan-content rows** (patterns A/B/C/D and `unknown`):

- **Item-count estimate** — `sd.totalDataRows` shown as `~N items` next to the existing `{confidence}%` line.
- **Detected sections** — first ~8 unique non-empty `sd.sections[].headerText` as `secondary` badges under the reasoning line; `+N more` overflow badge when applicable.
- **Detected columns** — `sd.allColumnHeaders` as `outline` badges in a second row.
- **Merge note** — single muted helper line (matching today's wording: *"Items duplicated across sheets will be merged automatically."*) shown once when ≥2 plan-content sheets are checked.

Non-plan rows (`not_plan_content`, `empty`) keep current minimal display — no badges, no item count — to avoid steering noise.

The detection call is wrapped in try/catch so any parser hiccup degrades silently to today's picker rendering.

### Change 2 — Importer skip behavior (no code change needed)

`src/components/steps/SpreadsheetImportStep.tsx` already routes:

- `preselectedSheetIndices` non-empty → jump straight to `'mapping'` phase
- otherwise → `'detection'` phase (the `DetectionSummary` UI)

Since the picker now always passes indices when classifier output is present, the detection screen is already only reached on the fallback path (classifier failed/timed out, or user picked all). Confirming in the plan rather than touching the file.

### Files touched

- `src/components/steps/SheetPickerStep.tsx` — import `detectStructure`, memoize per-sheet detection, render item-count + section/column badges + merge note inside the existing classified-sheet rows.

### Out of scope (still deferred)

- `DetectionSummary.tsx` removal — kept as fallback, unchanged.
- 4b parsers, 4d picker redesign, 4e Pattern D dead-end.

### Validation

Re-run Astera (20 sheets) and DRAFT:

1. Picker renders per-sheet `~N items`, section badges, and column badges on plan-content sheets.
2. Merge note appears once ≥2 plan sheets are checked, disappears at ≤1.
3. Continuing into the importer goes straight to **mapping** — no second sheet-list screen.
4. Force-fail classifier path (timeout/error) still routes through `DetectionSummary` unchanged.
