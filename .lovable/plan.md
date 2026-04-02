

# UI Polish — Compact Stepper, Two-Column Layout, Screen Cleanup

## Changes

### 1. Compact Wizard Stepper (`WizardProgress.tsx`)
Replace large circles + labels with a slim horizontal bar:
- Thin `h-1` progress track with small `h-6 w-6` dots at each step position
- Completed dots show a tiny checkmark, active dot has a ring highlight
- Step labels rendered as small text below each dot
- Total height ~40px, down from ~120px
- Remove `py-6` → `py-2`

### 2. Rename headings (`Index.tsx` + `ScanResultsStep.tsx`)
- `WIZARD_STEPS[1].title`: `'Configure'` → `'Review & Configure'`
- `ScanResultsStep` heading: `'Configure Extraction'` → `'Review & Configure'`
- Subtitle: → `'Confirm your organization and adjust settings before processing.'`

### 3. Two-Column Layout for ScanResultsStep (`ScanResultsStep.tsx`)
- Increase container from `max-w-2xl` → `max-w-5xl`
- Wrap the 5 cards in a `grid grid-cols-1 lg:grid-cols-2 gap-4` layout
- Left column: Org match card, Plan Structure card
- Right column: Document Scope, Time Estimate, Additional Notes
- "Start Processing" button spans full width below the grid
- Reduce `space-y-6` → `space-y-4` throughout

### 4. Inline Hint on Disabled Button (`ScanResultsStep.tsx`)
- When `!orgReady` (org match pending), show a small muted message above the button:
  `"↑ Please confirm your organization above to continue"`
- Render conditionally: only when `lookupResult !== null && orgConfirmed === null`

### 5. Hide File Upload Chrome During Processing (`FileUploadStep.tsx`)
- When `isLoading` is true, hide the outer Card header ("Upload Your Strategic Plan"), the file status card, and the Continue button — show **only** the `ProcessingOverlay`
- Optionally show file name as a subtitle inside the overlay area
- When extraction is complete (`extractedItems` exists, not loading):
  - Wrap the preview list in a collapsible section (collapsed by default) using `Collapsible` from shadcn
  - Keep the summary line ("47 items extracted") and "Continue with X Items" button always visible

### 6. Reduce Spacing
- `ScanResultsStep`: `space-y-6` → `space-y-4`, card padding already compact
- `FileUploadStep`: `space-y-6` → `space-y-4` in the outer wrapper

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/WizardProgress.tsx` | Full redesign to compact bar with small dots |
| `src/components/steps/ScanResultsStep.tsx` | Two-column grid, rename heading/subtitle, disabled hint, tighter spacing |
| `src/components/steps/FileUploadStep.tsx` | Hide upload chrome during processing, collapsible preview, tighter spacing |
| `src/pages/Index.tsx` | Update `WIZARD_STEPS[1].title` to `'Review & Configure'` |

No backend, edge function, or pipeline changes.

