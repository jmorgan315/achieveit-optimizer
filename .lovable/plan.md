

# Fix: Increase extraction stall threshold to 120s

## Change

**File**: `src/components/steps/FileUploadStep.tsx`, line 287

Change `stallDuration > 30000` → `stallDuration > 120000`

This is a single-value change. The post-extraction threshold (20s at line 316) stays as-is.

