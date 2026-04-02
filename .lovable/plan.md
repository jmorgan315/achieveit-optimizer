

# Updated Plan: Screen 2 — ScanResultsStep (Configure)

This is the same plan as previously approved, with two targeted additions.

---

## Addition 1: Skip LevelVerificationModal when levels already configured

**Problem:** If the user configures plan levels on Screen 2 (ScanResultsStep), `handleAIExtraction` and `handleTextSubmit` in Index.tsx unconditionally set `setShowLevelModal(true)`, forcing a redundant confirmation.

**Fix in `src/pages/Index.tsx`:**

In `handleAIExtraction` and `handleTextSubmit`, check if `processingConfig.planLevels` is non-empty. If so, skip the modal and apply levels + advance directly:

```typescript
const handleAIExtraction = (items, personMappings, levels) => {
  setLevels(levels);
  setPendingAIData({ items, personMappings });

  if (processingConfig?.planLevels?.length) {
    // User already configured levels on Screen 2 — skip modal
    const configuredLevels = processingConfig.planLevels.map((name, i) => ({
      depth: i, name
    }));
    setLevels(configuredLevels);
    setItems(items, personMappings);
    updateLevelsAndRecalculate(configuredLevels);
    setPendingAIData(null);
    advanceToStep(3); // skip to people/review
  } else {
    setShowLevelModal(true);
  }
};

const handleTextSubmit = (text: string) => {
  setRawText(text);
  setPendingAIData(null);

  if (processingConfig?.planLevels?.length) {
    processText();
    advanceToStep(3);
  } else {
    setShowLevelModal(true);
  }
};
```

Same logic: if `processingConfig.planLevels` has entries, the user already made their choice — proceed directly. If empty, show the modal as before.

---

## Addition 2: useRef guard for autoStart instead of empty dependency array

**Problem:** An empty `useEffect` dependency array triggers ESLint `react-hooks/exhaustive-deps` warnings and is fragile.

**Fix in `src/components/steps/FileUploadStep.tsx`:**

```typescript
const hasAutoStarted = useRef(false);

useEffect(() => {
  if (autoStart && uploadedFile && !hasAutoStarted.current && !extractedItems) {
    hasAutoStarted.current = true;
    handleFileUpload(uploadedFile);
  }
}, [autoStart, uploadedFile, extractedItems]);
```

The ref ensures the extraction fires exactly once even if dependencies re-evaluate during processing. Reset the ref in the existing `clearFile` function so re-uploads work:

```typescript
const clearFile = () => {
  hasAutoStarted.current = false;
  // ... existing clear logic
};
```

---

## Everything else from the approved plan remains unchanged

- New `ScanResultsStep.tsx` component with 5 sections (Org Match, Plan Structure, Document Scope, Time Estimate, Additional Notes)
- Index.tsx routing: Step 0 → UploadIdentifyStep, Step 1 → ScanResultsStep, Step 2 → FileUploadStep (processing bridge)
- `handleStartProcessing` handler storing `ProcessingConfig` in state
- Spreadsheet bypass logic
- No edge function or pipeline changes

