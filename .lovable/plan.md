

# Structured Plan Levels, Page Range & Level Pre-population

## Overview

Enhance the Organization Profile step with structured inputs for plan levels and page ranges, make page ranges actionable during processing, pass user-defined levels to extraction prompts, and pre-populate the Level Verification Modal.

## Changes

### 1. Update `OrgProfile` type (`src/types/plan.ts`)

Add two new optional fields:
```typescript
planLevels?: Array<{ depth: number; name: string }>;
pageRange?: { startPage: number; endPage: number };
```

### 2. Redesign `OrgProfileStep` (`src/components/steps/OrgProfileStep.tsx`)

Replace the single `documentHints` textarea with three sections:

**Section A: Plan Structure** — Collapsible card with a checkbox "I know my plan's hierarchy levels". When checked, show:
- Number stepper (min 1, max 7, default 3)
- Dynamic list of labeled text inputs: "Level 1 (highest):", "Level 2:", etc.
- Pre-populated defaults: Strategic Priority, Objective, Goal (truncated to stepper count)

**Section B: Document Scope** — Two side-by-side number inputs: "Plan starts on page" / "Plan ends on page". Validation: start < end, both positive.

**Section C: Additional Notes** — Existing textarea, relabeled with updated placeholder.

All three feed into `OrgProfile` and are passed through `handleConfirm`.

### 3. Make Page Range Actionable

**Vision path** (`src/utils/pdfToImages.ts` → `renderPDFToImages`):
- Add optional `pageRange?: { startPage: number; endPage: number }` parameter
- Filter rendering to only pages within the range (1-indexed)
- Log which pages were included

**Vision path** (`src/components/steps/FileUploadStep.tsx`):
- Pass `orgProfile.pageRange` to `renderPDFToImages` when available
- Pass `pageRange` to `process-plan` so it's logged in metadata

**Text path** (`supabase/functions/parse-pdf/index.ts`):
- The `unpdf` library's `extractText` doesn't support page-specific extraction natively
- **Fallback approach**: After extraction, if `pageRange` is provided as a form field, split text by page markers and extract only the relevant pages' content. If page boundaries aren't detectable, pass the full text but add a strong prompt instruction (Option A from the request)

**Orchestrator** (`supabase/functions/process-plan/index.ts`):
- Accept `pageRange` in the request body
- Pass it through to Agent 1 calls
- Log `pageRangeApplied`, `startPage`, `endPage` in metadata

**Agent 1 prompts** (`extract-plan-items` and `extract-plan-vision`):
- When `pageRange` is provided, inject prompt instruction: "The user indicated the actionable plan content is on pages {start} through {end}. Focus extraction ONLY on content from those pages."

### 4. Pass Structured Levels to Extraction Prompts

**Orchestrator** (`process-plan/index.ts`):
- Accept `planLevels` in request body, pass to all 3 agents

**Agent 1** (`extract-plan-items/index.ts` and `extract-plan-vision/index.ts`):
- When `planLevels` is provided, inject into user message:
  ```
  PLAN HIERARCHY SCHEMA (provided by user — treat as authoritative):
  Level 1 (highest): {name}
  Level 2: {name}
  ...
  Every extracted item MUST be assigned to one of these levels.
  ```

**Agents 2 & 3**: Pass `planLevels` so they validate against the user's schema.

### 5. Pre-populate Level Verification Modal (`src/components/steps/LevelVerificationModal.tsx`)

- Accept new optional prop: `userDefinedLevels?: Array<{ depth: number; name: string }>`
- When present, use these as the initial levels instead of AI-detected ones
- Show note: "Using your predefined plan levels. You can still adjust them here."
- If AI-detected levels differ from user-defined, show warning with detected level names

### 6. Wire through Index.tsx

- Pass `orgProfile.planLevels` to `FileUploadStep` (already has `orgProfile`)
- Pass `orgProfile.planLevels` to `LevelVerificationModal` as `userDefinedLevels`
- In `handleAIExtraction`: if user defined levels, prefer those over AI-detected

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/types/plan.ts` | Add `planLevels` and `pageRange` to `OrgProfile` |
| `src/components/steps/OrgProfileStep.tsx` | Rebuild with 3 sections (levels, page range, notes) |
| `src/utils/pdfToImages.ts` | Add `pageRange` parameter to `renderPDFToImages` |
| `src/components/steps/FileUploadStep.tsx` | Pass page range to rendering + pipeline |
| `src/components/steps/LevelVerificationModal.tsx` | Add pre-population + mismatch warning |
| `src/pages/Index.tsx` | Wire user-defined levels to modal |
| `supabase/functions/process-plan/index.ts` | Accept + pass `planLevels` and `pageRange` |
| `supabase/functions/extract-plan-items/index.ts` | Inject planLevels/pageRange into prompt |
| `supabase/functions/extract-plan-vision/index.ts` | Inject planLevels/pageRange into prompt |
| `supabase/functions/audit-completeness/index.ts` | Accept planLevels for context |
| `supabase/functions/validate-hierarchy/index.ts` | Accept planLevels for validation |

## Execution Order

1. Update `OrgProfile` type
2. Rebuild `OrgProfileStep` UI
3. Add page range support to `renderPDFToImages`
4. Update `FileUploadStep` to pass page range + plan levels
5. Update `LevelVerificationModal` with pre-population
6. Wire through `Index.tsx`
7. Update all 5 edge functions (process-plan, extract-plan-items, extract-plan-vision, audit-completeness, validate-hierarchy)
8. Deploy edge functions

