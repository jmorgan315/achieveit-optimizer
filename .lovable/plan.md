# Phase 4c.2a — Stage A2, Step 2: Implementation

Cleanup (Step 0) is complete and approved. This plan covers Steps 2–5: migration, new edge function, helpers, caller integration, deploy, then stop at A/A audit.

I'm in plan mode and can't write files directly — approving this plan switches to build mode and I'll execute everything below in one pass, then stop and report before any audit work.

## 1. Migration

```sql
ALTER TABLE public.processing_sessions
  ADD COLUMN column_hints jsonb;
```

Nullable, no default. No RLS changes (existing session policies cover it).

## 2. New edge function: `supabase/functions/extract-column-hints/index.ts`

**Purpose:** Suggest AchieveIt attribute roles for non-structural columns. Orthogonal to `classify-spreadsheet-layout` — does not touch structural fields.

**Input schema (zod):**
```ts
{
  sessionId: string (uuid),
  sheets: Array<{
    sheet_name: string,
    header_row_index: number | null,
    hierarchy_columns: number[],          // ignored, passed for exclusion
    name_column_index: number | null,     // ignored, passed for exclusion
    column_previews: Array<{
      column_index: number,
      header: string | null,
      sample_values: string[]             // 5–10 non-null samples
    }>
  }>,
  persist?: boolean (default true)
}
```

**Output:**
```ts
{
  column_hints: Array<{
    sheet_name: string,
    hints: Array<{
      column_index: number,
      header: string | null,
      suggested_attribute: AttributeRole | null,
      confidence: 'high' | 'medium' | 'low',
      reason: string
    }>
  }>
}
```

**Locked enum (15 values, no substitutions):**
`description`, `status`, `start_date`, `due_date`, `assigned_to`, `members`, `administrators`, `update_frequency`, `metric_description`, `metric_unit`, `metric_rollup`, `metric_baseline`, `metric_target`, `current_value`, `tags`

`null` is allowed when no role applies (column should be ignored downstream).

**Model:** `claude-sonnet-4-5` via `ANTHROPIC_API_KEY` (matches existing classifier; not Lovable AI gateway since we need tool-use JSON guarantees consistent with the rest of the agent stack).

**Prompt:** Single-pass per chunk. System prompt explains AchieveIt import template attributes (one calibration line per enum value). User prompt provides sheet name + a compact table of `(column_index, header, sample_values[:8])` for non-hierarchy/non-name columns only (filtering happens server-side using `hierarchy_columns` ∪ `{name_column_index}`). Returns strict JSON via `response_format: json_schema` tool use.

**Chunking:** ≤6 sheets → 1 call. >6 → 2-sheet chunks, sequential, with a 30s per-chunk timeout and `Promise.allSettled`-style accumulation so one chunk failure doesn't void the others.

**Error handling:**
- Per-chunk try/catch; failed chunks logged as `hint` diagnostics with `status: 'error'`, omitted from output.
- Anthropic 429/5xx → 1 retry with 2s backoff.
- Final response always 200 with whatever hints succeeded; full failure returns `{ column_hints: [] }` plus error log.

**Persistence (when `persist !== false`):**
- Service-role client writes `column_hints` jsonb to `processing_sessions` for `sessionId`.
- `persist: false` is the temporary A/A audit hook only; will be removed at end of Stage A2 along with the audit driver.

**Diagnostics (`parser_diagnostics`, parser_name `extract-column-hints`):**
- One `extraction` row per call: sheets processed, hint counts by confidence, duration, token usage.
- One `hint` row per individual hint with `{column_index, header, suggested_attribute, confidence, reason}`.

**CORS:** standard `corsHeaders` import from `npm:@supabase/supabase-js@2/cors`, included on all responses including errors.

**Auth:** JWT validated in code (function deploys with `verify_jwt = false` per Lovable defaults); session ownership check against `processing_sessions.user_id = auth.uid()` before persisting.

## 3. Shared helper: `src/utils/hierarchyColumns.ts`

Single source of truth used by `columnHintInput.ts` now and the Stage-B parser later.

```ts
export interface HierarchyColumnSpec {
  hierarchy_columns: number[];
  name_column_index: number | null;
}

export function deriveHierarchyColumns(
  layoutSheet: LayoutClassificationSheet
): HierarchyColumnSpec
```

Returns the union of structural column indices that the hint extractor must skip. Pulls from the existing layout classification shape (`hierarchy_columns`, `name_column_index`). Deduped + sorted.

## 4. Caller helper: `src/utils/columnHintInput.ts`

```ts
export function buildColumnHintInput(
  sessionId: string,
  layoutClassification: LayoutClassification,
  workbookPreview: WorkbookPreview      // from existing parse step
): ExtractColumnHintsInput
```

For each sheet in the layout classification:
- Compute structural columns via `deriveHierarchyColumns`.
- Pull header row from `workbookPreview` using `header_row_index`.
- For each non-structural column, collect up to 8 non-null sample values from rows below the header.
- Skip sheets classified as `not_plan_content` or with `pattern === 'not_plan_content'`.

## 5. Caller integration: `src/components/steps/FileUploadStep.tsx`

5-line addition in the `.then()` block after `classify-spreadsheet-layout` resolves successfully:

```ts
const hintInput = buildColumnHintInput(sessionId, layoutResult, workbookPreview);
if (hintInput.sheets.length > 0) {
  supabase.functions.invoke('extract-column-hints', { body: hintInput })
    .catch((err) => console.warn('[extract-column-hints] non-blocking failure', err));
}
```

Fire-and-forget: failures must NOT block the user-facing pipeline. Result lands in `processing_sessions.column_hints` for Stage-B consumption.

## 6. Deploy

`supabase--deploy_edge_functions(['extract-column-hints'])`. Verify deploy succeeds, then `curl_edge_functions` a smoke request with a known session to confirm 200 + persisted row.

## 7. STOP — checkpoint before A/A audit

After deploy + smoke test, I post:
- Migration confirmation
- Deploy status
- Smoke-call result (sheets in, hints out, persisted row snippet)

Then wait for explicit approval before building `audit-hints-replay` and running the 5-file × 2-pass A/A diagnostic.

## Strict scope

In: migration, new function, 2 helpers, 5-line caller add, deploy, smoke test.
Out: any change to `classify-spreadsheet-layout`, UI surfacing of hints, Stage-B parser work, audit driver (next checkpoint).

## Risks

1. **Workbook preview shape mismatch** — `buildColumnHintInput` depends on the existing in-memory preview structure; if it doesn't expose row-level samples below the header, helper needs to re-read the cached parse result. Will verify shape during implementation and adjust helper, not extend scope.
2. **Anthropic latency on wide workbooks** — 2-sheet chunks with 30s timeout should keep us under edge function 150s budget for typical files; truly pathological workbooks (>20 sheets) may partial-fail. Acceptable for A2; revisit if A/A shows it.
3. **Non-determinism on hint outputs** — same concern that killed the classifier extension. A/A gate (next step) exists specifically to measure this before Stage B depends on it.
