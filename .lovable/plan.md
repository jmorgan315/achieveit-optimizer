

# UI Tweaks Follow-Up

## Changes

### 1. Smaller Stepper Dots (`WizardProgress.tsx`)
- Reduce dots from `h-6 w-6` → `h-4 w-4`
- Reduce checkmark icon from `h-3 w-3` → `h-2.5 w-2.5`
- Remove step number text inside dots (too small now) — completed dots get checkmark, others get a filled/empty dot
- Change `py-2` → `py-1` to reduce top/bottom padding
- Adjust track position from `top-3` → `top-2` to match new dot center
- Header is 64px (`h-16`), stepper target ≤16px, total ≤80px

### 2. Full-Screen Scanning Overlay (`UploadIdentifyStep.tsx`, lines 512-538)
- Change the overlay from `absolute inset-0 bg-background/80 backdrop-blur-sm rounded-lg` to `fixed inset-0 bg-background/80 z-50` (no backdrop-blur, no rounded corners)
- This makes it a full-screen semi-transparent overlay that won't clip any content
- Center the scan status card in the middle of the viewport

### 3. Move Time Estimate Inline Above Button (`ScanResultsStep.tsx`)
- Remove the Time Estimate `<Card>` from `rightColumn` (lines 397-410)
- Add an inline muted text line between the grid and the button area: `"Estimated: ~1-2 minutes • 9 pages • presentation document"` using `Clock` icon + muted styling
- Right column becomes: Document Scope + Additional Notes only

### 4. Compact Confirmed Org State (`ScanResultsStep.tsx`)
- The confirmed state card (lines 269-279) is already fairly compact with a one-line layout showing name + industry + checkmark
- Review and ensure it's truly single-line: remove the `<div>` wrapper around name/industry, make it a single `<p>` with `{lookupResult.name} • {industry}` inline with the checkmark
- Reduce padding: `py-3` → `py-2`

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/WizardProgress.tsx` | Smaller dots (h-4 w-4), less padding (py-1), adjust track position |
| `src/components/steps/UploadIdentifyStep.tsx` | Change scanning overlay to fixed full-screen semi-transparent |
| `src/components/steps/ScanResultsStep.tsx` | Move time estimate inline above button; compact confirmed org card |

No backend changes.

