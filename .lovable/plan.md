

# Add File Size Pre-check & Graceful Fallback for parse-pdf

## Problem
The "always try text first" logic sends >10MB files to parse-pdf, which returns 413. User sees a failed extraction instead of a seamless fallback to vision.

## Changes — single file: `src/components/steps/FileUploadStep.tsx`

### 1. Add size pre-check before parse-pdf call (around line 398)

Before the `parsePdfWithEdgeFunction` call, check file size:

```typescript
const MAX_TEXT_EXTRACTION_SIZE = 8 * 1024 * 1024; // 8MB

if (file.size > MAX_TEXT_EXTRACTION_SIZE) {
  console.log(`Document exceeds 8MB (${(file.size / 1024 / 1024).toFixed(1)}MB) — using visual analysis`);
  addMessage('Document uploaded successfully');
  // Skip directly to vision path
} else {
  // Try text extraction first (existing logic)
}
```

If file > 8MB, skip the entire text extraction block and fall through to the vision path at line 440.

### 2. Improve error fallback in the existing catch block (line 403)

Currently the catch just logs and continues — but it falls through to the vision path correctly. Enhance the message:

```typescript
catch (error) {
  console.log(`Text extraction failed (${error?.message || error}), falling back to visual analysis`);
  addMessage('Switching to visual analysis...');
}
```

This handles 413, 500, timeouts, and any other parse-pdf errors gracefully — no toast error, no runtime error shown to user, just a seamless fallback to vision.

### Summary of flow after fix

```text
PDF uploaded
├─ file > 8MB? → skip text, go straight to vision
└─ file ≤ 8MB? → try parse-pdf
   ├─ parse-pdf succeeds → evaluate text quality → text or vision
   └─ parse-pdf fails (any error) → log, fallback to vision
```

