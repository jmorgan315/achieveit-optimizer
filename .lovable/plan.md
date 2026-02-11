

# Smart Extraction Pipeline with Automatic Fallback and Verification

## Problem

The uploaded PDF has its actual plan content in images/tables, but the text extraction pulls out just the term definitions (enough text to pass quality checks). The text-based AI correctly detects the hierarchy levels but finds 0 plan items. The app currently stops there -- it never falls back to Vision AI when text extraction "succeeds" but yields no items.

## Solution Overview

Build a cascading extraction pipeline that automatically tries the next method when the current one produces insufficient results, plus a verification step to validate extraction quality.

```text
File Upload
    |
    v
Step 1: Extract text from PDF
    |
    v
Step 2: Quality gate (length, gibberish ratio)
    |-- FAIL --> Vision AI directly
    |-- PASS --> Text-based AI extraction
                    |
                    v
Step 3: Result gate (did AI find items?)
    |-- 0 items --> Fall back to Vision AI (keep detected levels as hint)
    |-- Items found --> Continue
                          |
                          v
Step 4: Verification (behind the scenes)
    |-- Check: items have proper nesting (not all flat)
    |-- Check: item count is reasonable for page count
    |-- Check: detected levels match item structure
    |-- If verification fails --> Retry with Vision AI
    |
    v
Step 5: Present results to user
```

## Changes

### 1. Add Vision AI Fallback After Empty Text Extraction
**File**: `src/components/steps/FileUploadStep.tsx`

In `handleFileUpload`, after `extractPlanItemsWithAI(extractedText)` completes, check if `extractedItems` is null or empty. If so, and the file is a PDF, automatically trigger `extractWithVisionAI(file)` as a fallback. The text-based extraction's `detectedLevels` (e.g., pillar, objective, strategy) are preserved and passed as a hint to Vision AI.

Key changes to `extractPlanItemsWithAI`:
- Return a result object `{ items, levels }` instead of setting state and returning void
- This allows `handleFileUpload` to inspect the result and decide whether to fall back

Key changes to `handleFileUpload` (PDF branch):
- After text AI returns 0 items, show status "Text analysis found no items, trying visual analysis..." and call `extractWithVisionAI(file)`
- Pass detected levels from text extraction as context to Vision AI

### 2. Add Extraction Verification
**File**: `src/components/steps/FileUploadStep.tsx`

Add a `verifyExtractionResult` function that runs after any extraction method returns items. Checks include:

- **Minimum item count**: At least 1 item found (warn if fewer than expected for page count)
- **Nesting check**: Not all items should be flat at root level -- at least some should have children
- **Level consistency**: Items' levelTypes should match the detected levels
- **Reasonable depth**: No item should be deeper than the number of detected levels

If verification fails on text extraction, fall back to Vision AI. If verification fails on Vision AI too, present what we have with a warning toast.

### 3. Pass Text-Detected Levels as Context to Vision AI
**File**: `src/components/steps/FileUploadStep.tsx`

When falling back from text to vision, pass the detected level names (e.g., "pillar", "objective", "strategy", "kpi") as `previousContext` to `extractWithVisionAI`. This gives the Vision AI a head start on understanding the document's hierarchy terminology.

Modify `extractWithVisionAI` to accept an optional `levelHints` parameter that gets included in the first batch's context.

### 4. Refactor for Cleaner Flow
**File**: `src/components/steps/FileUploadStep.tsx`

Restructure the PDF handling in `handleFileUpload` to be a clear pipeline:

```text
handleFileUpload (PDF):
  1. parsePdfWithEdgeFunction() --> text + pageCount
  2. Quality gate (existing checks)
  3. extractPlanItemsWithAI(text) --> { items, levels }
  4. If items.length === 0:
       - extractWithVisionAI(file, levels as hints)
  5. verifyExtractionResult(items)
  6. If verification fails and haven't tried vision yet:
       - extractWithVisionAI(file)
  7. Set state with final results
```

## Files to Modify

| File | Change |
|------|--------|
| `src/components/steps/FileUploadStep.tsx` | Refactor extraction flow: make `extractPlanItemsWithAI` return results instead of setting state; add fallback logic after 0 items; add `verifyExtractionResult` function; pass level hints to vision fallback |

## What This Fixes

- The Strategic Vision PDF: text extraction finds definitions + levels but 0 items, so the app automatically falls back to Vision AI which can read the tabular content from the page images
- Any future PDF where text is extractable but content is primarily visual
- Provides verification that catches poor extractions before presenting to user
