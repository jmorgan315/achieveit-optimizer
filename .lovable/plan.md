

# Revised Plan: Fix three post-extraction pipeline issues

All changes from the approved plan remain the same, with one adjustment to Issue 2:

## Issue 2 (revised): Stall detector thresholds by state

In `src/components/steps/FileUploadStep.tsx`, use different thresholds depending on whether an agent is actively running:

- **`"auditing"`** → 120 seconds (Agent 2 is running, needs time to finish)
- **`"validating"`** → 120 seconds (Agent 3 is running, needs time to finish)
- **`"audited"`** → 20 seconds (nothing running, just need to kick off Agent 3)

Everything else from the approved plan is unchanged.

