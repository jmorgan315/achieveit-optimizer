## Phase 4a polish: picker timeout + classifier dedupe

Two small fixes off the Test 3 (Astera) and Test 2 (DRAFT) findings. Picker producer/consumer wiring stays as-is.

### Fix 1 — Picker polling timeout: 60s → 120s

**Why:** Astera (20 sheets, 4 chunks) finished classification at 66s, just past the picker's 60s timeout. JSON populated correctly in `processing_sessions.layout_classification`, but the picker had already fallen through to "AI analysis unavailable". Bumping to 120s gives ~2x headroom over the worst case in our sample.

**Change:** `src/components/steps/SheetPickerStep.tsx` line 25
```
const POLL_TIMEOUT_MS = 60_000;
```
→
```
const POLL_TIMEOUT_MS = 120_000;
```

Polling cadence (1.5s) and fallback UI unchanged. The "Analyzing workbook structure…" state is already shown for the full duration, so the longer timeout just means users on large workbooks wait a bit longer before the fallback kicks in — which is exactly what we want.

### Fix 2 — Canonicalize `exclude_sheets` at the classifier prompt (cleaner fix)

**Why:** Test 2 surfaced both "Use of Funds" and "use of funds" as separate bullets in the suggestions panel because the model echoed the user's note phrasing alongside the canonical sheet name. Fixing at the source keeps downstream data clean (admin panel, future consumers, audits).

**Change:** `supabase/functions/classify-spreadsheet-layout/index.ts`, in the `PARSER DIRECTIVES` section of `PATTERN_GUIDE` (line 64), tighten the `exclude_sheets` description:

Replace:
```
- exclude_sheets: string[] — sheet names the user's notes explicitly say to skip. Empty by default.
```
with:
```
- exclude_sheets: string[] — sheet names the user's notes explicitly say to skip. Each entry MUST be the exact canonical sheet name as it appears in the workbook (matching one of the sheetName values in the input). Do NOT include the user's phrasing, paraphrases, or case variants. If the user's note refers to a sheet by an approximate name, resolve it to the single canonical sheet name. Deduplicate. Empty by default.
```

No schema change, no code change beyond the prompt string. Edge function redeploys automatically.

### Out of scope

- Producer/consumer wiring (already shipped, working in Tests 1–3 modulo the timeout).
- Picker UI redesign (4d), Pattern D dead-end (4e), parsers (4b/4c) — still deferred.
- Client-side dedupe fallback — skipping per your vote for the cleaner fix. If a future test still shows dupes, we can layer a `toLowerCase()` Set dedupe in `SheetPickerStep` as belt-and-suspenders.

### Validation after deploy

Re-run the Astera upload (20 sheets, ~66s classifier). Expect:
1. Picker stays in "Analyzing workbook structure…" through the ~66s window, then transitions to the success view — no fallback banner.
2. Sheets render grouped by pattern, plan-content sheets pre-checked.
3. **Scope-variation banner check:** since Astera's classifier output had `needs_user_clarification: true` with `clarification_type: "scope_variation"`, the picker should now render the clarification `<Alert>` at the top with title "Scope variations" and the `clarification_reason` as the body. (Code path already exists at `SheetPickerStep.tsx:268-279` — this test just confirms it fires end-to-end for the first time.)

Re-run the DRAFT upload. Expect the suggestions panel to show `Use of Funds` exactly once under "Sheets you asked to skip" — no case-variant duplicate.

### Files touched

- `src/components/steps/SheetPickerStep.tsx` — one-line constant bump.
- `supabase/functions/classify-spreadsheet-layout/index.ts` — prompt tightening for `exclude_sheets`.
