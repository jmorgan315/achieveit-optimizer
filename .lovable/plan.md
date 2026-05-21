
# Phase 4c.2a — Pre-flight Audit (Stage A only)

Audit-only workflow. No production code, no UI changes, no parser changes. Single deliverable: Table A + Table B pasted in chat as a discrete checkpoint.

---

## Step 1 — Baseline coverage check (blocking)

Query `processing_sessions` for the most recent successful run per file in the six-file regression set:

- Astera Health
- Santa Cruz
- Tulane
- Carmen
- State Reporting Template
- Initiative 1

For each file, report: most-recent `layout_classified_at`, session id, sheet count in `layout_classification.sheets`, and whether `layout_classification.error` is set.

**If any file has no usable classification** (missing row, error sentinel, or no completed import): stop, paste the coverage table, list the missing files, and await direction. Baseline imports happen on current production code before any audit work resumes — never interleaved.

If all six are covered, proceed to Step 2.

## Step 2 — Dev-branch deploy of `classify-spreadsheet-layout`

Single edge-function change, reverted before any production code lands:

1. Add the new `column_hints` field to `layoutToolSchema` (additive, optional).
2. Append the `COLUMN HINTS` section to `PATTERN_GUIDE` (per prior plan §1).
3. Add a `dryRun: boolean` request flag. When `dryRun === true`: skip the `processing_sessions.update` write and skip `logApiCall` persistence; return the merged classifier output in the response body only.
4. Deploy. No client code calls it with `dryRun: true` — invocation is exclusively via `supabase--curl_edge_functions`.

Production behavior is unchanged because every real call site omits `dryRun`, and the new schema field is additive. Function will be reverted (or kept gated behind `dryRun` until 4c.2a implementation PR) before this phase closes.

## Step 3 — Re-classify the six files

For each file, reconstruct the original `workbookPreview` payload from the source file in `source-documents` storage (same truncation rules the function applies internally: 30 rows × 12 cols × 80 chars). Invoke the dev-branch function with `dryRun: true`, original `orgName`, and original `documentHints` from the saved session row.

Capture the response per sheet. No DB writes occur.

## Step 4 — Deliver Table A + Table B

**Table A — structural-field comparison (blocking gate)**

Compares the dev-branch response against the saved `layout_classification.sheets[]` entry for the same sheet. Fields: `pattern`, `header_row_index`, `data_starts_at_row`, `name_column_index`, `hierarchy_signal`, `implied_levels` (set equality, order-insensitive), `section_marker_pattern`. `confidence` is reported but ±10 tolerance, not blocking.

| File | Sheet | Field | Before | After | Match |
|------|-------|-------|--------|-------|-------|

**Table B — `column_hints` visibility (informational)**

| File | Sheet | column_hints_count | Sample 1 (col, attr, conf) | Sample 2 | Sample 3 |
|------|-------|--------------------|----------------------------|----------|----------|

Samples are the first 3 hints by ascending `column_index`. Empty cells when fewer than 3 exist.

## Step 5 — Gate

- **Any Table A row with `Match = false` on a regression-file sheet** → stop, paste both tables, surface to user, no production code, no green-light.
- **Table A fully clean** → paste both tables in chat as a discrete checkpoint. Await explicit approval before opening any 4c.2a implementation PR.

## Step 6 — Cleanup

Whether the audit passes or fails, revert the dev-branch edge-function deploy as the final step of Stage A so production classifier returns to its pre-audit state. The `dryRun` flag and `column_hints` schema additions will reappear as part of the approved 4c.2a implementation PR — not lingering in production between phases.

## Strict scope — files touched in Stage A

Only `supabase/functions/classify-spreadsheet-layout/index.ts`, temporarily. Reverted at end of Stage A. Nothing else.

Stage B (implementation per prior plan §1–§11) only begins after this checkpoint is approved.
