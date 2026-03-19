

# Add Industry-Specific Tips to Processing Overlay

## Overview
Replace the static contextual message card with rotating industry-specific tips that match the user's selected industry. Falls back to generic messages when no industry is provided.

## Changes

### 1. `ProcessingOverlay.tsx` — add industry tips and rotation

- Add new prop: `industry?: string`
- Create an `INDUSTRY_TIPS` map with all 7 industries as keys, each containing the provided tip strings
- Create a `GENERIC_TIPS` array using the current contextual messages as fallback
- Replace the static `CONTEXTUAL_MESSAGES[currentStep]` card with a rotating tip display:
  - On mount and every ~8 seconds, pick the next tip from the industry's list
  - Show the industry name as a small label (e.g. "LOCAL GOVERNMENT INSIGHT")
  - If no industry match, show the current step-based contextual message (existing behavior)

### 2. `FileUploadStep.tsx` — pass industry prop

- Add `industry={orgProfile?.industry}` to the `<ProcessingOverlay>` usage (line 652)

### Files

| File | Change |
|------|--------|
| `src/components/steps/ProcessingOverlay.tsx` | Add `industry` prop, `INDUSTRY_TIPS` data, rotating tip display |
| `src/components/steps/FileUploadStep.tsx` | Pass `industry` prop to ProcessingOverlay |

