

# Bug: classificationResult is wrapped in `{ success, classification }` envelope

## Root Cause

In `UploadIdentifyStep.tsx` line 290:
```typescript
classificationResult = result;  // result = { success: true, classification: { document_type, hierarchy_pattern, ... } }
```

The entire API response is stored, but `ScanResultsStep` reads fields directly off the object (e.g., `result.document_type`, `result.hierarchy_pattern`). Those fields live one level deeper at `result.classification.document_type`.

## Fix

**File: `src/components/steps/UploadIdentifyStep.tsx`** — line 290

Change:
```typescript
classificationResult = result;
```
To:
```typescript
classificationResult = result.classification;
```

This unwraps the envelope so `ScanResultsStep` receives the actual classification object with `document_type`, `hierarchy_pattern`, `plan_content_pages`, etc. at the top level.

One-line fix. No other files need changes — `ScanResultsStep`'s field access paths are already correct for the unwrapped shape.

