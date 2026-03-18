

# Fix Wizard Navigation State Preservation

## Problem

Both `OrgProfileStep` and `FileUploadStep` store all their form state in local `useState` hooks. When the wizard step changes, these components unmount and remount, losing all user input. The "Start Over" button only appears on step 3.

## Solution: Lift State to Index.tsx

### 1. Lift OrgProfileStep form state

Move these local states from `OrgProfileStep` into `Index.tsx` and pass them as props:
- `orgName`, `industry`, `documentHints` — text inputs
- `knowsLevels`, `levelCount`, `levelNames` — plan structure inputs
- `startPage`, `endPage` — page range inputs
- `lookupResult` — org lookup result (so the confirmation card persists)

New props interface for `OrgProfileStep`:
```typescript
interface OrgProfileStepProps {
  // existing
  onComplete: (profile: OrgProfile) => void;
  onSkip: () => void;
  sessionId?: string;
  // new — lifted state + setters
  orgName: string; setOrgName: (v: string) => void;
  industry: string; setIndustry: (v: string) => void;
  documentHints: string; setDocumentHints: (v: string) => void;
  knowsLevels: boolean; setKnowsLevels: (v: boolean) => void;
  levelCount: number; setLevelCount: (v: number) => void;
  levelNames: string[]; setLevelNames: (v: string[]) => void;
  startPage: string; setStartPage: (v: string) => void;
  endPage: string; setEndPage: (v: string) => void;
  lookupResult: LookupResult | null; setLookupResult: (v: LookupResult | null) => void;
}
```

### 2. Lift FileUploadStep extraction state

Move key states from `FileUploadStep` into `Index.tsx`:
- `uploadedFile` — the File object reference
- `extractedItems`, `extractedMappings`, `detectedLevels` — extraction results
- `fileContent` — extracted text content
- `useVisionAI` — which method was used

This ensures going back to step 0 and returning to step 1 shows the previous upload and extraction results without re-triggering extraction. Only `clearFile` or uploading a new file resets these.

Processing-specific state (`isProcessing`, `isExtracting`, `progressState`, etc.) stays local since it's transient.

### 3. Move "Start Over" to all steps

Move the "Start Over" button with confirmation dialog into the sticky action bar, visible on all steps (not just step 3). Keep it styled as a small, non-prominent destructive ghost button. The `handleStartOver` function already resets all state correctly — just also reset the newly lifted OrgProfileStep and FileUploadStep states.

### 4. Prevent re-extraction on back-navigation

When returning to step 1 with existing extraction results, the component should show the "completed" state (file info + extracted items preview + Continue button) instead of the upload dropzone. This already works if `uploadedFile` and `extractedItems` persist — the current render logic checks `!uploadedFile` to show the dropzone.

### 5. Session preservation

`handleBack` already just calls `setCurrentStep(currentStep - 1)` without touching the session. No change needed — the session is preserved as long as `resetState()` isn't called.

## Files to Modify

| File | Change |
|------|--------|
| `src/pages/Index.tsx` | Add lifted state for OrgProfile form fields and FileUpload results. Pass as props. Move Start Over to sticky bar on all steps. Reset lifted state in `handleStartOver`. |
| `src/components/steps/OrgProfileStep.tsx` | Remove local `useState` calls for form fields. Accept them as props instead. |
| `src/components/steps/FileUploadStep.tsx` | Accept `uploadedFile`, `extractedItems`, `extractedMappings`, `detectedLevels`, `fileContent`, `useVisionAI` and their setters as props. Remove corresponding local state. |

## What stays the same
- `WizardProgress` already supports clicking completed steps
- `usePlanState` already holds items/levels/personMappings at the parent level
- `LevelVerificationModal` already receives state from parent
- `PeopleMapperStep` already receives state from parent (no local state to lose)

