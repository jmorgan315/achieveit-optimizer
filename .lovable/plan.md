

# Phase 1: Large Document Support + Multi-Entity Extraction

Backend-only changes. No UX restructure. Ship, test, then tackle Part 4 separately.

---

## Part 1: Raise Page Limits to 250

Three files, one shared constant where possible.

| File | Change |
|------|--------|
| `supabase/functions/parse-pdf/index.ts` | Change `MAX_PAGES = 100` → `250` (line 8) |
| `src/utils/pdfToImages.ts` | Change default `maxPages = 100` → `250` in function signature (line 29) |
| `src/components/steps/FileUploadStep.tsx` | Change hardcoded `100` → `250` in `renderPDFToImages(file, 100, ...)` call (line 375) |

A shared constant isn't practical across edge function + client code, so each is updated independently but documented together.

---

## Part 2: Chunk Agent 0 Classification for 50+ Pages

**Where**: `supabase/functions/process-plan/index.ts`, inside `runPipeline()`, the Agent 0 block (lines 614-659).

**Current behavior**: Sends ALL `pageImages` to `classify-document` in a single call.

**New behavior**:
- If `pageImages.length <= 50`: existing single-call behavior (no change)
- If `pageImages.length > 50`: chunk into groups of 25 pages
- Call `classify-document` once per chunk
- Each chunk call logged as `"Step 0: Document Classification (Chunk N/M)"`
- Merge results across chunks:
  - **page_annotations**: concatenate all arrays, adjusting page numbers per chunk offset
  - **document_type**: majority vote across chunks
  - **confidence**: average across chunks
  - **hierarchy_pattern**: use the one with highest confidence or from the first chunk
  - **table_structure**: use the first non-null result
  - **plan_content_pages / skip_pages**: union across chunks
- The merged classification object replaces the single-call result — downstream pipeline (page filtering, buffer, extraction) works unchanged

**No changes to `classify-document/index.ts` itself** — it processes whatever images it receives.

---

## Part 3: Multi-Entity Document Extraction

Prompt-only changes to two edge functions. No logic changes.

### `supabase/functions/extract-plan-vision/index.ts`

Append to `VISION_EXTRACTION_PROMPT` (after the existing "DUPLICATE DETECTION" section, before "STEP 5: OUTPUT STRUCTURE" or at the end of rules):

```
=== MULTI-SECTION / MULTI-ENTITY DOCUMENTS ===

Some documents contain plans from multiple organizations, states, departments,
or entities — each with their own section. When you detect this pattern:

- Each entity name (e.g., state name, department, division) → Level 1 (top-level item)
- Programs, goals, or focus areas within each entity → Level 2 (children of entity)
- Initiatives, strategies, action items → Level 3+ (children of programs)

Look for repeating structural patterns across entity sections. If "Alabama" has
"Program Title → Initiatives", expect the same for "Alaska", "Arizona", etc.

If the document is a single organization's plan (not multi-entity), ignore this
guidance and extract normally.
```

### `supabase/functions/extract-plan-items/index.ts`

Append similar multi-entity guidance to `EXTRACTION_SYSTEM_PROMPT` (after the "SELF-CHECK BEFORE RESPONDING" section).

### `supabase/functions/validate-hierarchy/index.ts`

Append to `VALIDATION_SYSTEM_PROMPT` (after "HANDLING AUDIT FINDINGS"):

```
=== MULTI-ENTITY DOCUMENTS ===

If the extracted items appear to come from multiple organizations, states, or
entities (e.g., many items named "[State] Rural Health Transformation Program"):

- Entity-level items should be at Level 1
- Programs/goals within each entity at Level 2, parented to their entity
- Initiatives/actions at Level 3+, parented to their program

If items are flat (all at the same level) but clearly belong to different entity
sections, restructure them into the correct hierarchy using entity name patterns
as signals for Level 1 grouping.
```

---

## Summary of All Files

| File | Part | Change |
|------|------|--------|
| `supabase/functions/parse-pdf/index.ts` | 1 | `MAX_PAGES` 100 → 250 |
| `src/utils/pdfToImages.ts` | 1 | Default `maxPages` 100 → 250 |
| `src/components/steps/FileUploadStep.tsx` | 1 | Hardcoded 100 → 250 |
| `supabase/functions/process-plan/index.ts` | 2 | Chunk classification for 50+ pages |
| `supabase/functions/extract-plan-vision/index.ts` | 3 | Multi-entity prompt addition |
| `supabase/functions/extract-plan-items/index.ts` | 3 | Multi-entity prompt addition |
| `supabase/functions/validate-hierarchy/index.ts` | 3 | Multi-entity prompt addition |

No database migrations needed. No new edge functions. No UX changes.

