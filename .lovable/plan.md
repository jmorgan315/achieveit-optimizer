

# Unify & Simplify Processing Screen

## Problem
Text and vision extraction paths show different UI, expose technical details (Vision AI, page counts, character counts), and the extraction method decision is based on file size instead of text quality.

## Changes

### 1. Rewrite `ProcessingOverlay.tsx` — unified, simplified

**Replace entirely** with a clean component:

- **Header**: Always show `"Analyzing [Org Name]'s Plan"` / `"Reviewing your document..."` — no mention of vision/text method
- **4 unified steps** (same for both paths): `Upload → Extract → Audit → Validate`
- **Progress bar**: Continuous 0-100% mapped to step ranges: Upload 0-15%, Extract 15-60%, Audit 60-80%, Validate 80-100%
- **Remove** time elapsed and time remaining displays entirely (or keep elapsed as tiny `text-muted-foreground/40` text)
- **Remove** `estimatedSecondsRemaining` prop
- **Remove** `isVisionNeeded` prop — no longer needed since UI is unified
- **Contextual status card** replaces rotating tips: show phase-appropriate message ("Scanning your document for goals, priorities, and initiatives...", "Cross-checking extracted items...", "Verifying hierarchy and structure...")
- **Activity log**: collapsed by default (`logOpen` defaults to `false` — already the case), simplified messages

New props interface:
```typescript
interface ProcessingOverlayProps {
  currentStep: 'upload' | 'extract' | 'audit' | 'validate';
  stepProgress: number; // 0-100 within current step
  statusMessages: string[];
  orgName?: string;
}
```

Progress calculated internally: `stepRanges[currentStep].start + stepProgress/100 * stepRange`

### 2. Update `FileUploadStep.tsx` — simplified messages & unified flow

- **Replace `ProcessingPhase` type** usage with new 4-step type
- **Simplify `addMessage` calls** throughout:
  - `"Document uploaded successfully"` (not page/char counts)
  - `"Extracting plan items..."` → `"Extraction complete — found X items"`
  - `"Reviewing for completeness..."` → `"Audit complete"`
  - `"Validating structure..."` → `"Validation complete"`
- **Remove vision/text distinction from UI**: no `useVisionAI` badge, no "Vision AI" or "AI Enhanced" labels
- **Completed extraction banner** (line 782-802): Remove the purple/green badge that says "Vision AI" vs "AI Enhanced". Just show `"X items extracted successfully"`
- **Bottom button** (line 832-844): Remove "Vision AI Analyzing..." vs "AI Analyzing..." distinction. Just show `"Analyzing..."` when loading, `"Continue with X Items"` when done (no Brain/Eye icon differentiation)

### 3. Text extraction strategy fix in `FileUploadStep.tsx`

Replace the current decision logic (lines 479-577):

```
Current: file > 10MB → vision; else try text → check length/gibberish → fallback to vision
New: ALWAYS try parse-pdf first (remove 10MB skip) → evaluate text quality by chars/page:
  - charsPerPage = text.length / pageCount
  - If charsPerPage > 200 AND gibberish ratio > 0.3 → text path
  - Else → vision path
  - Log: "Text quality: X chars/page, threshold: 200. Decision: text/vision"
```

Remove the `FILE_SIZE_LIMIT` / `skipTextExtraction` block entirely. Always attempt text extraction first.

### 4. Remove "AI Analyzing" bottom button banner

The bottom `<Button>` at line 827 currently shows `"Vision AI Analyzing..."` / `"AI Analyzing..."` with a spinner. Simplify to just `"Analyzing..."` with spinner. No Eye/Brain icon distinction.

### Files to modify

| File | Change |
|------|--------|
| `src/components/steps/ProcessingOverlay.tsx` | Full rewrite: unified 4-step UI, no vision/text distinction, contextual status, no time displays |
| `src/components/steps/FileUploadStep.tsx` | Simplified messages, unified UI labels, text-quality-based extraction decision, remove vision/text badges |

