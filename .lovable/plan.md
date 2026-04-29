## Plumb Additional Notes to all 5 AI agents (Phase 1, PDF/vision/text path only)

Approved adjustments captured: keep the duplicated 5-line helper inline with a `// duplicated in 5 agents; keep in sync` comment in each file; gate #5 (resume) is a live test, not a code-review test; new gate #6 verifies the user-prompt duplicate-removal half of Change 4 actually shipped.

### Pre-fix diagnosis (confirmed)

The textarea on Screen 2 (ScanResultsStep) collects `additionalNotes` and passes it to `onStartProcessing(config)` at line 221. `Index.tsx` `handleStartProcessing` (line 415) ignores `config.additionalNotes` entirely. Downstream `FileUploadStep` reads `orgProfile?.documentHints`, which `ScanResultsStep` never sets. Result: zero of the 5 agents receive the user's notes today.

Server-side, three of the five agents already have prompt construction code that reads `documentHints` (classify-document, extract-plan-items, extract-plan-vision) — but they never get a non-undefined value because the front-end gap blocks it. The remaining two agents (audit-completeness, validate-hierarchy) don't even accept the field on their request body.

### Changes

**1. `src/pages/Index.tsx` `handleStartProcessing`** — copy `config.additionalNotes` into `orgProfile.documentHints` and mirror to `documentHints` state:

```ts
const notes = config.additionalNotes?.trim() || '';
setOrgProfile({ ...config.orgProfile, documentHints: notes || undefined });
setDocumentHints(notes);
```

**2. New migration** — `ALTER TABLE public.processing_sessions ADD COLUMN document_hints text;`

**3. `supabase/functions/process-plan/index.ts`**
- On pipeline start (around line 727): persist `document_hints: documentHints || null` to the session row alongside `pipeline_run_id`.
- In the resume path (around line 1485): if `pipeCtx.documentHints` is undefined, fall back to `session.document_hints`.
- At every `callEdgeFunction("audit-completeness", ...)` site (lines 1378, 1879) and every `callEdgeFunction("validate-hierarchy", ...)` site (lines 1975, 2035): add `documentHints` to the payload.
- Thread `documentHints` through `runAgent2Only` and `runAgent3Only` signatures (lines 1838, 1938) and their two callers in the resume orchestrator (lines 1812, 1818) so the resume path retains notes.

**4. Per-agent prompt edits** — add this duplicated 5-line helper to each of the 5 edge function files, with a `// duplicated in 5 agents; keep in sync` comment, then prepend the result to the **system** prompt and remove any existing duplicate user-prompt mention:

```ts
// duplicated in 5 agents; keep in sync
function buildUserContextBlock(notes?: string | null): string {
  const t = (notes ?? "").trim();
  if (!t) return "";
  return `USER-PROVIDED CONTEXT (treat as authoritative guidance about this specific document):\n${t}\n\n`;
}
```

Per-file:
- `classify-document/index.ts`: prepend block to `CLASSIFICATION_SYSTEM_PROMPT` at both call sites (lines 504, 289). Remove `Additional context: …` append in `buildUserPrompt` (line 186-188).
- `extract-plan-items/index.ts`: in `processChunk`, prepend block to the `system:` value (line 459) using `orgContext?.documentHints`. Remove the `User-provided document hints: …` line in `parts.push` (line 419).
- `extract-plan-vision/index.ts`: prepend block to every `system:` field (text + table + presentation modes) using `documentHints` from request body. Remove the `User-provided document hints: …` line in `parts.push` (line 754).
- `audit-completeness/index.ts`: accept `documentHints` from request body; prepend block to both system prompts (text + vision) wherever they are used (the `dedupExclusionNote` branches around lines 322 and 355).
- `validate-hierarchy/index.ts`: accept `documentHints` from request body; prepend block to `VALIDATION_SYSTEM_PROMPT` at the call site (line 245).

Empty/null notes ⇒ helper returns `""` ⇒ zero added tokens.

### Files modified

| File | Change |
|---|---|
| `src/pages/Index.tsx` | Copy `additionalNotes` into orgProfile + state |
| `supabase/migrations/<new>.sql` | Add `processing_sessions.document_hints text` |
| `supabase/functions/process-plan/index.ts` | Persist hints, hydrate on resume, forward to audit + validate, thread through runAgent2/3Only |
| `supabase/functions/classify-document/index.ts` | Helper + system-prompt prepend; remove user-prompt duplicate |
| `supabase/functions/extract-plan-items/index.ts` | Helper + system-prompt prepend; remove user-prompt duplicate |
| `supabase/functions/extract-plan-vision/index.ts` | Helper + system-prompt prepend; remove user-prompt duplicate |
| `supabase/functions/audit-completeness/index.ts` | Helper + accept documentHints + system-prompt prepend |
| `supabase/functions/validate-hierarchy/index.ts` | Helper + accept documentHints + system-prompt prepend |

### Out of scope

Spreadsheet path (Phase 2). UI changes to the textarea. Any prompt tuning beyond inserting the notes block.

### Regression gates (run live, not by code review)

1. **Chattanooga PDF, no notes** — extracts to 47 items; logs show no `USER-PROVIDED CONTEXT` block in any agent.
2. **Chattanooga PDF, notes = "Ignore the executive summary on pages 1-3"** — extracts to ~47 items; agent logs show the block in system prompts of all 5 agents.
3. **Messier prior session, notes = "We use 3 levels: Goals, Objectives, Tactics"** — re-run; validate-hierarchy output reflects user-stated levels.
4. **Token usage** — empty notes path adds zero tokens (verify against api_call_logs.input_tokens).
5. **Live self-chained resume** — kill orchestrator mid-pipeline (e.g. cause a chain dispatch between Agent 1 and Agent 2). Confirm Agent 2 and Agent 3 still receive the notes block in their system prompts, sourced from `processing_sessions.document_hints` rather than the original request body. **Must be tested live, not via code review.**
6. **Duplicate-removal verification** — after a notes-populated run, inspect the user prompt sent to extract-plan-items in `api_call_logs`. The string `User-provided document hints:` must NOT appear in the user prompt; it must only appear (transformed into the new block) in the system prompt. Same check for extract-plan-vision and classify-document.

### Report-back format

- Files changed list with line ranges.
- Live results for all 6 gates (especially #5 live resume test and #6 duplicate-removal evidence).
- Sample edge function log line showing `USER-PROVIDED CONTEXT:` in a system prompt when notes are populated.