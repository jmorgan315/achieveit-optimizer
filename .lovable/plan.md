# Phase 3 — AI Layout Classifier for Excel/CSV (revised)

Analysis-only. Classifier runs fire-and-forget after spreadsheet parse, persists structured result to the session, and surfaces in an admin viewer for user-driven validation. Phase 4 (later) wires the result into the parser dispatch.

## What ships

### 1. DB migration

Add to `processing_sessions`:
- `layout_classification jsonb`
- `layout_classified_at timestamptz`

### 2. New edge function `classify-spreadsheet-layout`

- Auth: standard JWT validation in code (`getClaims`), default deploy
- Model: **`claude-sonnet-4-6`** via existing `ANTHROPIC_API_KEY` (matches the rest of the agent stack)
- Input: `{ sessionId, orgName, documentHints?, workbookPreview }` where preview = per-sheet array of `{ sheetName, rows: string[][] }`, capped at **30 rows × 12 cols**, each cell truncated to **80 chars**
- Chunking: classify sheets in groups of 5 to keep cost <$0.10/workbook
- Tool-calling for structured output
- Fail-soft: any error writes `{ error, model, classified_at }` sentinel; never throws back to client
- Logs to `api_call_logs` with `step_label = 'classify_layout'`
- Persists merged result to `layout_classification` and stamps `layout_classified_at`

**Output schema (persisted):**
```json
{
  "workbook_summary": {
    "primary_pattern": "A|B|C|D|mixed",
    "needs_user_clarification": true,
    "clarification_reason": "Multiple time-versioned tabs detected (Jan, Feb, Mar)"
  },
  "sheets": [
    {
      "sheet_name": "All In",
      "pattern": "A|B|C|D|not_plan_content|empty|unknown",
      "confidence": 0,
      "reasoning": "...",
      "structure": {
        "header_row_index": 2,
        "data_starts_at_row": 3,
        "name_column_index": 1,
        "hierarchy_signal": "section_headers|category_columns|column_nested|pivot_rows",
        "implied_levels": ["Strategy", "Outcome", "Action"],
        "section_marker_pattern": "^(Strategy|Goal):"
      }
    }
  ],
  "model": "claude-sonnet-4-6",
  "tokens": { "input": 0, "output": 0 },
  "duration_ms": 0
}
```

### 3. Pattern definitions in the prompt

- **A — Form/section-block**: section headers like `Strategy:` / `Goal:` with rows below; column meaning shifts per section
- **B — Flat list with hierarchy column(s)**: one row per item, level encoded in a column (e.g. "Type" = Goal/Strategy/Action) or by indent
- **C — Column-nested**: hierarchy encoded across columns (Strategy col → Outcome col → Action col on same row)
- **D — Pivot/scorecard**: metrics in rows, time/owner in columns
- **not_plan_content**: README, config, dept lookup, budget — present but not plan items
- **empty / unknown**: no extractable signal

### 4. Client wiring (fire-and-forget, no UI on the import path)

- `src/components/steps/SpreadsheetImportStep.tsx`: after the existing parse step succeeds, call `supabase.functions.invoke('classify-spreadsheet-layout', { body: { sessionId, orgName, documentHints, workbookPreview } })` without `await` blocking the user
- `src/components/steps/FileUploadStep.tsx`: forward `orgName` + `documentHints` props down so the classifier has org context
- No loading state, no toast on the import flow — Phase 4 will read `layout_classification` from the session

### 5. Admin viewer on `SessionDetailPage`

When `layout_classification` is present on the session, render a new "Layout Classification" panel (admin-visible only, like other admin surfaces on that page):
- **Workbook summary**: primary_pattern badge, needs_user_clarification flag, clarification_reason
- **Per-sheet table**: sheet_name · pattern badge · confidence · hierarchy_signal · implied_levels · header_row_index / data_starts_at_row / name_column_index · reasoning (collapsible)
- **Cost footer**: pulled from `api_call_logs` where `session_id = ? AND step_label = 'classify_layout'` — sum input/output tokens, compute $ at Sonnet rates, show duration
- **Raw JSON toggle**: collapsible `<pre>` with the full `layout_classification` blob for copy/paste
- Fail-soft sentinel renders as a red error card with the stored error message

This is the validation surface — user uploads the 8 sample files and reads results here.

## Regression gates (must all pass)

1. PDF flow unchanged — extraction, dedup, export still work
2. Excel flow still completes to the mapping screen (classifier is non-blocking)
3. Operational Plan .xlsx → 685 items
4. DRAFT Initiative 1 → 24 items

## Files touched

- `supabase/migrations/<timestamp>_layout_classification.sql` (new)
- `supabase/functions/classify-spreadsheet-layout/index.ts` (new)
- `src/components/steps/SpreadsheetImportStep.tsx` (fire-and-forget invoke)
- `src/components/steps/FileUploadStep.tsx` (forward orgName/documentHints)
- `src/pages/SessionDetailPage.tsx` (+ likely a new `LayoutClassificationPanel.tsx`) — admin viewer

## Report-back after implementation

- Files changed
- Confirmation classifier deploys and is invoked from the spreadsheet path
- Screenshot/description of the admin viewer rendering against one test session
- Confirmation all 4 regression gates pass
- Reference for user validation: expected patterns are
  - Working_Master_SP (Alfred) → A
  - Santa Cruz Operational Plan → B
  - DRAFT State Reporting Template → A on Initiative tabs; not_plan_content on Config/README
  - RWJUHS Strategic Scorecard → D
  - Astera Health Operational Plan → A across 20 sheets, needs_user_clarification=true
  - AchieveIt Final Excel Document → C on All In; not_plan_content on Programming Budget / Dept Leads
  - OGSM CDO Monthly Update → C, needs_user_clarification=true (time-versioned sheets)
  - Plan_upload_test (Carmen/Zonetta) → B

User runs the 8 uploads, reads the admin viewer, and decides whether to escalate to `claude-opus-4-6` or proceed to Phase 4.
