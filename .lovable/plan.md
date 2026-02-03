

# Plan: Increase Text Extraction Character Limit

## Summary
Increase the character limit for text-based extraction from 100,000 to 300,000 characters, and remove the Vision AI fallback for long text.

## Changes

### 1. Edge Function (`supabase/functions/extract-plan-items/index.ts`)
- Change `MAX_TEXT_LENGTH` from `100000` to `300000` (line 9)

### 2. Frontend (`src/components/steps/FileUploadStep.tsx`)
- Remove the text length check that falls back to Vision AI (the code added in the last diff)

## Technical Notes
- Gemini models support very large context windows (1M+ tokens), so 300k characters (~75k tokens) is well within limits
- This keeps the text-based extraction as the primary path since you find it more reliable

