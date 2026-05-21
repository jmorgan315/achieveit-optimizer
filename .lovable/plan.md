## Phase 4c.2a — Stage A: Pre-flight Classifier Audit (rev 2)

Baseline coverage complete. Two corrections applied from latest feedback:
- **Confidence is an enum** (`'high' | 'medium' | 'low'`), not numeric. Matches original §1 spec; 4c.2b UI will render literal chips.
- **Alfred U has 2 sheets**: Strategic Plan Template + Univ Metrics. Univ Metrics is expected to classify as `pattern: 'not_plan_content'` with no `column_hints` — that row in Table A is expected, not a regression.

### Regression set (6 files)

| # | Label | Session ID | Sheets |
|---|---|---|---|
| 1 | Astera Health | `ec27e3de…6b67103` | 20 |
| 2 | Santa Cruz | `097ff122…d4744d7a` | 1 |
| 3 | Tulane | `934b184a…6e8413d3fd95` | 3 |
| 4 | Carmen (in_progress, classification intact) | `6beb14a0…23439764b49a` | 1 |
| 5 | State Reporting Template | `d144f066…91d93daee8` | 6 |
| 6 | Alfred U | `1a444816-f339-4b6f-ad32-b179bf2ce6b1` | 2 (incl. Univ Metrics → not_plan_content) |

### Step 2 — Dev-branch deploy of `classify-spreadsheet-layout`

Single-file edit, reverted at end of Stage A:

1. Extend `layoutToolSchema` with optional per-sheet `column_hints: Array<{col_index: number, suggested_attribute: string, confidence: 'high' | 'medium' | 'low', reason?: string}>`. Additive; existing fields unchanged.
2. Append a `COLUMN HINTS` section to `PATTERN_GUIDE` instructing the model to emit hints for non-standard attribute columns (owner, due date, status, frequency, measurement, etc.) when present, with `confidence` as one of `high | medium | low` and a short `reason`.
3. Add `dryRun: boolean` request flag. When true: skip all DB writes (`processing_sessions.layout_classification`, `layout_classified_at`), skip `parser_diagnostics` inserts, return the full merged tool-call payload only.
4. Production safety: every existing call site omits `dryRun` → behavior unchanged. New schema field is additive (model may omit on small or non-plan sheets without failing parse).

Deploy to dev branch only. No production code path is altered.

### Step 3 — Re-classify all 6 files

For each session:
- Load original `workbookPreview` source. If `step_results` holds it, reuse; otherwise reconstruct from `source-documents` bucket via the same preview-extraction code path the production importer uses.
- Invoke dev-branch `classify-spreadsheet-layout` with `dryRun: true`.
- Capture response per sheet.

### Step 4 — Deliver Table A + Table B (single checkpoint)

**Table A — Structural fields (blocking gate).** One row per sheet across all 6 files. Columns:
`File | Sheet | Field | Before (saved baseline) | After (dryRun re-classify) | Match`

Fields compared (exact match required on regression files):
- `pattern`
- `header_row_index`
- `data_starts_at_row`
- `name_column_index`
- `hierarchy_signal`
- `implied_levels`
- `section_marker_pattern`

Expected (not a regression): Alfred U → Univ Metrics row with `pattern: 'not_plan_content'`.

**Table B — Column hints (informational, 4c.2b input visibility).** One row per sheet:
`File | Sheet | column_hints_count | Sample 1 (col_index, suggested_attribute, confidence) | Sample 2 | Sample 3`

Confidence values in samples will be literal `high` / `medium` / `low`. Sheets classifying as `not_plan_content` (e.g. Alfred U → Univ Metrics) will show `column_hints_count: 0`.

### Step 5 — Gate

- Any `Match = false` on a regression sheet in Table A → **stop**, paste both tables, no production code, no 4c.2a PR. Surface specific regression(s) for diagnosis.
- All `Match = true` → paste both tables in chat as a discrete checkpoint, await explicit approval before opening the 4c.2a implementation PR (Stage B: §1–§11 of the original spec).

### Step 6 — Cleanup

At end of Stage A, regardless of outcome: revert dev-branch `classify-spreadsheet-layout` to production state. The `column_hints` schema extension, `PATTERN_GUIDE` addendum, and `dryRun` flag reappear in the approved 4c.2a implementation PR — they do not linger in production between stages.

### Strict scope for Stage A

Only `supabase/functions/classify-spreadsheet-layout/index.ts`, temporarily. No parser, no UI, no DB migrations, no Stage B work until checkpoint is approved.
