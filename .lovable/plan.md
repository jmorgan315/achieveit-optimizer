

# Multi-Agent Extraction Pipeline

## Overview

Replace the single-pass AI extraction with a 3-agent pipeline: Extractor → Completeness Auditor → Hierarchy Validator, with confidence scoring on every item.

## Architecture

```text
Frontend (FileUploadStep)
  │
  ├─ parse-pdf (unchanged)
  │
  └─ POST /process-plan  ◄── NEW orchestrator edge function
       │
       ├─ Agent 1: extract-plan-items (existing, prompt refined)
       │
       ├─ Agent 2: audit-completeness (NEW edge function)
       │
       ├─ Agent 3: validate-hierarchy (NEW edge function)
       │
       └─ Merge + confidence scoring (in process-plan)
```

## Data Model Changes

Add two optional fields to `PlanItem` in `src/types/plan.ts`:
- `confidence?: number` (0-100)
- `corrections?: string[]` (list of what was changed and by which agent)

No database schema changes needed — these are UI-only fields that don't persist.

## Files to Create

### 1. `supabase/functions/process-plan/index.ts` — Orchestrator

- Accepts: `{ documentText, organizationName, industry, documentHints, sessionId, pageImages? }`
- Calls Agent 1 (extract-plan-items or extract-plan-vision) internally via fetch to the same Supabase functions URL
- Calls Agent 2 (audit-completeness) with source text + Agent 1's items
- Calls Agent 3 (validate-hierarchy) with source text + Agent 1's items + Agent 2's audit
- Runs merge/confidence scoring logic
- Logs all 3 agent calls to `api_call_logs` with step labels: "Agent 1: Extraction", "Agent 2: Completeness Audit", "Agent 3: Hierarchy Validation"
- Returns final items with confidence scores + corrections + overall sessionConfidence
- Handles vision fallback: if Agent 1 was vision-based, passes that context through

### 2. `supabase/functions/audit-completeness/index.ts` — Agent 2

- Input: `{ sourceText, extractedItems, sessionId, organizationName?, industry? }`
- Uses Anthropic Claude with tool_use for structured output
- System prompt: Completeness auditor role. Goes section-by-section through source, identifies missing/merged/rephrased items
- Tool schema returns `{ missingItems[], mergedItems[], rephrasedItems[], auditSummary }` as specified in the request
- Full source text (no chunking) — if exceeds 180K chars, truncate with a note
- Logged to `api_call_logs` under the session

### 3. `supabase/functions/validate-hierarchy/index.ts` — Agent 3

- Input: `{ sourceText, extractedItems, auditFindings, detectedLevels, sessionId, organizationName?, industry? }`
- Uses Anthropic Claude with tool_use
- System prompt: Hierarchy validator role. Verifies parent-child relationships, level assignments, ordering. Incorporates Agent 2's missing items, fixes rephrased names, splits merged items
- Tool schema returns `{ correctedItems[] (full plan tree), corrections[] }` where each correction documents what changed and why
- Logged to `api_call_logs`

## Files to Modify

### 4. `supabase/functions/extract-plan-items/index.ts` — Agent 1 prompt refinement

Add verbatim extraction instruction to `EXTRACTION_SYSTEM_PROMPT`:
```
=== VERBATIM TEXT EXTRACTION (CRITICAL) ===
For the 'name' field of each item, use the EXACT text from the document.
Do not rephrase, summarize, shorten, or 'clean up' the text.
Copy it character-for-character. If an item says 'Increase year-over-year
revenue growth by 15% through strategic market expansion', that entire
string is the name — do not shorten it to 'Increase revenue growth'.
```

### 5. `src/types/plan.ts`

Add `confidence?: number` and `corrections?: string[]` to `PlanItem` interface.

### 6. `src/components/steps/FileUploadStep.tsx`

- Replace direct calls to `extract-plan-items` / `extract-plan-vision` with a single call to `process-plan`
- Update progress phases: add `'audit'` and `'validate'` phases
- Progress display: "Step 1/3: Extracting plan items..." → "Step 2/3: Auditing completeness..." → "Step 3/3: Validating hierarchy..."
- Parse response to extract confidence scores and corrections
- Keep all existing fallback logic (vision fallback, verification checks) — these move into `process-plan`

### 7. `src/components/steps/ProcessingOverlay.tsx`

- Add two new phases: `'audit'` and `'validate'` to `ProcessingPhase` type and `PHASE_CONFIG`
- `audit`: label "Completeness Audit", icon `CheckCircle2`, description "Cross-checking extraction for missing items..."
- `validate`: label "Hierarchy Check", icon `GitBranch`, description "Validating structure and fixing issues..."

### 8. `supabase/config.toml`

Add entries for the three new functions:
```toml
[functions.process-plan]
verify_jwt = false

[functions.audit-completeness]
verify_jwt = false

[functions.validate-hierarchy]
verify_jwt = false
```

## Confidence Scoring Logic (inside `process-plan`)

For each item in Agent 3's output:
- **100**: Item exists in Agent 1 output, not flagged by Agent 2, not corrected by Agent 3
- **80**: Item existed in Agent 1 but Agent 3 made minor corrections (reorder, level change)
- **60**: Item was flagged as rephrased by Agent 2, corrected by Agent 3
- **40**: Item was missing from Agent 1, added by Agent 3
- **20**: Agents disagreed — Agent 3's best guess

`sessionConfidence` = average of all item confidence scores. Returned in response.

## Context Window Handling

- Agent 1: keeps existing chunking (25K chars)
- Agents 2 & 3: receive full text. If text > 180K chars (safe margin for Claude's 200K context), truncate to 180K with a note "Document truncated for analysis" appended
- Agent 2 also receives the full extracted items JSON
- Agent 3 receives extracted items + audit findings + source text

## Execution Order

1. Create `audit-completeness/index.ts` and `validate-hierarchy/index.ts`
2. Create `process-plan/index.ts` orchestrator
3. Refine Agent 1 prompt in `extract-plan-items`
4. Update `PlanItem` type
5. Update `ProcessingOverlay` with new phases
6. Update `FileUploadStep` to call `process-plan` instead of individual functions
7. Update `config.toml`
8. Deploy all new/modified edge functions

