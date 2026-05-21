## Phase 4c.2a — Stage A2: Separate `extract-column-hints` edge function (rev 2)

Corrections applied: enum locked to AchieveIt template (15 values), shared hierarchy helper confirmed, migration + cleanup commitments confirmed.

---

### 0. Cleanup (must complete + be confirmed before §1)

`supabase/functions/classify-spreadsheet-layout/index.ts` — only Stage-A1 residue left is the `dryRun` plumbing (schema/PATTERN_GUIDE were already reverted last turn).

Cleanup diff:

```diff
@@ line 277
-    const dryRun: boolean = body.dryRun === true;
@@ lines 312-326
-      if (!dryRun) {
-        logApiCall({ ... });
-      }
+      logApiCall({ ... });
@@ lines 431-439
-    if (!dryRun) {
-      const { error: updErr } = await supabase
-        .from("processing_sessions")
-        .update({ layout_classification: merged, layout_classified_at: new Date().toISOString() })
-        .eq("id", sessionId);
-      if (updErr) console.error("[classify-layout] persist error:", updErr.message);
-    } else {
-      console.log(`[classify-layout] dryRun=true — skipping persistence for session=${sessionId}`);
-    }
+    const { error: updErr } = await supabase
+      .from("processing_sessions")
+      .update({ layout_classification: merged, layout_classified_at: new Date().toISOString() })
+      .eq("id", sessionId);
+    if (updErr) console.error("[classify-layout] persist error:", updErr.message);
```

Also: delete `supabase/functions/audit-classify-replay/index.ts` + call `supabase--delete_edge_functions(["audit-classify-replay"])`.

I post the confirmation diff and **stop for approval** before §1.

---

### §1 — New edge function `extract-column-hints`

**File:** `supabase/functions/extract-column-hints/index.ts` (single new file).

#### Input

```ts
{
  sessionId: string,
  sheets: Array<{
    sheet_name: string,
    pattern: 'A' | 'B' | 'C',
    header_row_index: number,
    data_starts_at_row: number,
    name_column_index: number,
    hierarchy_columns: number[],
    column_previews: Array<{
      column_index: number,
      header: string,
      sample_values: string[]   // 5–10 non-empty values
    }>
  }>
}
```

Server-side guard: drop any `column_previews` entry whose `column_index ∈ hierarchy_columns ∪ {name_column_index}` **before** building the prompt.

#### Output

```ts
{
  success: true,
  data: {
    sheets: Array<{
      sheet_name: string,
      column_hints: Array<{
        column_index: number,
        suggested_attribute: AttributeRole,
        confidence: 'high' | 'medium' | 'low',
        reason: string
      }>
    }>,
    model: string,
    tokens: { input, output },
    duration_ms: number
  }
}
```

**`AttributeRole` — locked, 15 values, no substitutions, enforced as `enum` in Anthropic tool schema:**

```
description
status
start_date
due_date
assigned_to
members
administrators
update_frequency
metric_description
metric_unit
metric_rollup
metric_baseline
metric_target
current_value
tags
```

Excluded by design: `name`, `hierarchy_level`, `skip` (structural), `owner` (use `assigned_to`), `email` (not a standalone role), `notes`/`priority`/`numeric_metric` (not in AchieveIt template).

#### Model & call shape

Anthropic Claude Sonnet 4.6. Single tool `emit_column_hints` with `input_schema` enforcing the output, `enum` on `suggested_attribute` (15 values) and `confidence` (3 values). `tool_choice: { type: "tool", name: "emit_column_hints" }`. `max_tokens: 4096`.

#### Prompt (actual text)

**System:**

> You are a column-role classifier. Each sheet you receive has already been structurally classified — pattern, name column, and hierarchy columns are fixed inputs you must respect. Your ONLY job is to examine the remaining (non-structural) columns and, for each, decide whether it represents one of a fixed set of AchieveIt plan-item attribute roles. You MUST NOT re-evaluate the sheet's pattern, hierarchy, or name column. You MUST NOT emit a hint for any column not present in `column_previews` (those have been excluded as structural). The allowed roles are a closed set of 15 — emit only those, never invent new ones. If a column does not clearly match one of the allowed roles, OMIT it. Do not use `description` as a catch-all; reserve it for free-text paragraph-style content. Emit `confidence: high` only when header text AND sample values both align with the role; `medium` when one aligns; `low` when the match is plausible but weak.
>
> Calibration examples:
>
> - header "Description" / "Objective", samples ["Improve student retention by..."] → `description`, high
> - header "Status", samples ["On Track","Complete","At Risk"] → `status`, high
> - header "Start" / "Kickoff", samples ["1/15/25","3/1/25"] → `start_date`, high
> - header "Due" / "End Date", samples ["3/15/25","4/1/25"] → `due_date`, high
> - header "Assignee" / "Owner" / "Lead", samples ["jdoe@x.com"] or ["Jane Doe"] → `assigned_to`, high
> - header "Team Members" / "Members", samples ["a@x.com, b@x.com"] → `members`, high
> - header "Admins" / "Administrators", samples ["a@x.com, b@x.com"] → `administrators`, high
> - header "Frequency" / "Reporting Cadence", samples ["Quarterly","Monthly"] → `update_frequency`, high
> - header "Metric" / "Measurement Description", samples ["Track to Target","Maintain","Stay Above","Stay Below"] → `metric_description`, high
> - header "Unit" / "Format", samples ["Number","Dollar","Percentage","%"] → `metric_unit`, high
> - header "Rollup" / "Aggregation", samples ["Manual","Sum Children","Average"] → `metric_rollup`, high
> - header "Baseline" / "Starting Value", samples ["50","0"] → `metric_baseline`, high
> - header "Target" / "Goal", samples ["100","250"] → `metric_target`, high
> - header "Q1" / "Current" / "YTD", samples ["95%","87"] → `current_value`, medium
> - header "Tags" / "Categories", samples ["operations, finance"] → `tags`, high
> - header "Notes", samples ["See attached",""] → `description` IF prose-like, otherwise OMIT
> - Cell content discriminates header ambiguity: comma-separated emails + "team"/"members" → `members`; same cells + "admin" → `administrators`.

**User message (per workbook, all sheets concatenated):**

```
Sheet: <sheet_name>  (pattern <A|B|C>, header row <i>, data starts row <j>)
Name column: <k>
Hierarchy columns: [<...>]

Candidate columns:
  col <idx> | header: "<header>" | samples: ["v1","v2","v3","v4","v5"]
  col <idx> | header: "<header>" | samples: [...]
  ...

(blank line, repeat block per sheet)

Emit hints via the emit_column_hints tool.
```

#### Error handling & timeout

- 90s per-chunk timeout (Anthropic call wrapped in `Promise.race` + abort).
- Tool-call parse failure → log to `parser_diagnostics`, return `{ success: true, data: { sheets: [] } }` for the failing chunk (graceful degradation; hints are advisory).
- 5xx/429 → one retry with 2s backoff via existing `callAnthropicWithRetry` from `_shared/logging.ts`.
- `api_call_logs`: `edge_function: 'extract-column-hints'`, `step_label: 'extract_hints'`.

#### Chunking

Threshold: ~6000 estimated input tokens per chunk (`chars/4` heuristic). Default: 1 call for ≤6 sheets, 2-sheet chunks beyond. Constant at top of file. Astera's 20 sheets at ~300–500 input tokens each → 3–4 chunks, well inside 90s budget.

---

### §2 — Caller integration

**Correction to brief:** `classify-spreadsheet-layout` is invoked from the **frontend** (`src/components/steps/FileUploadStep.tsx` lines 918–930), not from `process-plan`. No server-side orchestrator chains these today.

**Proposed: chain in frontend.** Inside the existing `.then(({ error }) => ...)` at line 927, after a successful classifier response, build hint input and invoke `extract-column-hints`. Sketch:

```ts
.then(async ({ error, data }) => {
  if (error) { console.warn('[classify-layout] invoke error:', error); return; }
  if (!data?.success || !data?.data?.sheets) return;
  const { buildHintInput } = await import('@/utils/columnHintInput');
  const hintInput = buildHintInput(data.data, workbookPreview);
  if (hintInput.sheets.length === 0) return;
  supabase.functions
    .invoke('extract-column-hints', { body: { sessionId, sheets: hintInput.sheets } })
    .catch(err => console.warn('[extract-hints] invoke threw:', err));
})
```

`buildHintInput` lives in `src/utils/columnHintInput.ts` (new). Skips sheets where `pattern ∉ {A,B,C}`. Reads `data_starts_at_row..+15` from the in-scope `workbookPreview`, takes first 5–10 non-empty values per non-structural column. Calls the shared `deriveHierarchyColumns` (below).

---

### §3 — Persistence: choosing (a)

**Migration (will run via `supabase--migration` after cleanup approval, before deploying the new function):**

```sql
ALTER TABLE public.processing_sessions
  ADD COLUMN column_hints jsonb;
```

Nullable, no default. Existing RLS on `processing_sessions` covers it (no policy changes). Stored shape mirrors function output: `{ sheets: [...], model, tokens, duration_ms, hinted_at }`.

Rationale unchanged: separate column avoids re-coupling hints to structural fields (which is the exact failure mode Stage A1 proved).

---

### §4 — Shared hierarchy helper (confirmation)

**Shared infrastructure, single source of truth.**

New file: `src/utils/hierarchyColumns.ts`
```ts
export function deriveHierarchyColumns(
  sheet: LayoutClassificationSheet
): number[] { /* ... */ }
```

Consumers:
- Stage A2: `src/utils/columnHintInput.ts` imports it to build hint input.
- Stage B: the parser (Stage-B work in `parseHierarchicalColumns` or its replacement) imports the same function. No duplication.

Both consumers are frontend TypeScript — no type/import boundary issue. The edge function does NOT import it (Deno boundary); the frontend computes `hierarchy_columns` and passes it in the request body. This is the intended split: helper lives where both consumers live, edge function receives the result.

Derivation rules (initial implementation, conservative):
- Pattern A (header-marker / section): `[]` (sections are row-based, not column-based).
- Pattern B (level-typed): all columns whose header matches an implied-level name, else `[]`.
- Pattern C (column-nested): contiguous range `[0..name_column_index - 1]`. Conservative over-exclusion is acceptable for Stage A2 (worst case: a true attribute column gets excluded from hints, surfaces in audit).

---

### §5 — Diagnostics

`parser_diagnostics` writes with `parser_name: 'extract-column-hints'`:

- `log_type: 'extraction'` — once per workbook. Payload `{ sheets_processed, total_hints, hints_by_confidence: { high, medium, low }, model_used, duration_ms, chunks }`. `sheet_name: null`.
- `log_type: 'hint'` — once per emitted hint. Payload `{ sheet_name, column_index, header, suggested_attribute, confidence, reason }`.

Rendered by existing `ParserDiagnosticsCard` — no UI change for Stage A2.

---

### §6 — A/A validation plan

1. **Fixtures:** 5 files from Stage A1 (Carmen, Tulane, Santa Cruz, State Reporting Template, Alfred U). Astera optional add-on after coverage holds on 5.
2. **Driver:** temporary `audit-hints-replay` edge function. Loads each session's saved `layout_classification`, computes `hierarchy_columns` server-side using a Deno port of the helper logic (kept in sync manually for the audit, deleted after), invokes `extract-column-hints` **twice** back-to-back with `persist: false` flag.
3. **Metrics per sheet:**
   - **Coverage agreement** = Jaccard `|A∩B| / |A∪B|` on hinted column_index sets. Pass: ≥ 0.90.
   - **Attribute agreement** = on intersection, `count(attr_A==attr_B) / |intersection|`. Pass: ≥ 0.90.
   - **Confidence agreement** = on intersection, `count(conf_A==conf_B) / |intersection|`. Pass: ≥ 0.80.
4. **Output:** per-workbook table `Sheet | cols_A | cols_B | coverage | attr_agree | conf_agree` + rollup. Posted as Stage-A2 checkpoint.
5. **Gate:** coverage or attribute below threshold on any workbook → iterate prompt, do not proceed. Confidence-only misses → surface, non-blocking.

---

### §7 — Risks (top 3)

1. **Hint coverage drift.** Borderline columns (e.g., free-text "Notes") toggle in/out of the hint set. Mitigation: prompt's explicit "omit rather than guess" rule + the audit's coverage-agreement gate.
2. **`hierarchy_columns` derivation skew.** If our shared helper's view of hierarchy columns diverges from the eventual Stage-B parser's view, hints miss the wrong columns. Mitigation: single shared helper (§4), conservative over-exclusion in Stage A2.
3. **Frontend fire-and-forget timing.** User advances to SheetPicker before `extract-column-hints` resolves → picker reads null hints. Acceptable in Stage A2 (no consumer yet); flagged as Stage-B integration concern requiring the same polling pattern that exists for `layout_classification`.

---

### §8 — Cleanup commitment (end of Stage A2)

After A/A audit passes and you approve, I will:

(a) `supabase--delete_edge_functions(["audit-hints-replay"])` + delete `supabase/functions/audit-hints-replay/index.ts`.
(b) Strip `persist: false` flag from `supabase/functions/extract-column-hints/index.ts` (remove the body field, the `if (persist)` skip-guards on `logApiCall` and the DB write) and redeploy.

I will post a diff showing the byte-level revert and not begin Stage B until you confirm.

---

### Strict scope (Stage A2)

Touched:
- `supabase/functions/classify-spreadsheet-layout/index.ts` — cleanup only (revert `dryRun`).
- Delete `supabase/functions/audit-classify-replay/index.ts`.
- New: `supabase/functions/extract-column-hints/index.ts`.
- New: `src/utils/hierarchyColumns.ts`, `src/utils/columnHintInput.ts`.
- Modified: 5-line call-site addition in `src/components/steps/FileUploadStep.tsx`.
- Migration: `processing_sessions.column_hints jsonb`.
- Temporary during audit only: `supabase/functions/audit-hints-replay/index.ts` + `persist: false` flag — both removed before Stage B per §8.

NOT touched: parser, sheet picker UI, plan optimizer UI, type/enum definitions consumed by Stage B, `process-plan`, `audit-completeness`, any other edge function.

---

### Sequence

1. Apply cleanup, delete `audit-classify-replay`, post confirmation diff. **STOP for approval.**
2. On approval: run migration, implement `extract-column-hints` + helpers + FileUploadStep call site + diagnostics, deploy.
3. Run A/A audit, post results table. **STOP for approval.**
4. On approval: cleanup per §8. Stage A2 complete; Stage B resumes from original 4c.2a spec §1–§11.
