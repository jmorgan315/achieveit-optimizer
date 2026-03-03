

# Enhanced Processing UX: Progress Stages, Estimated Time, and Contextual Content

## Problem
After uploading a document, the AI extraction can take 30-120+ seconds (especially with Vision AI fallback and multiple batches). Currently the user sees a single status line that changes text — no sense of overall progress or time remaining.

## Approach
Replace the simple status text with a rich processing overlay that shows:
1. **Multi-stage progress bar** with clear phase indicators and estimated completion
2. **Rotating contextual tips/facts** based on their org profile and industry
3. **Live activity log** showing what the AI is doing in real-time

## Design

### Progress Stages
Track processing through defined phases, each with a weight toward 100%:

```text
Phase                  Weight    Description
─────────────────────────────────────────────
Upload & Parse PDF      10%     "Extracting text from your document..."
AI Text Analysis        40%     "AI is reading and structuring your plan..."
Verification            10%     "Verifying extraction quality..."
Vision AI (if needed)   40%     "Visual analysis of document pages..."
```

If Vision AI is not triggered, the text analysis phase scales to 80%. For chunked extraction, progress increments per chunk within the AI phase. For Vision AI batches, progress increments per batch.

### Estimated Time
- Calculate based on page count: ~3-5s per page for text, ~5-8s per page for vision
- Display as "Estimated time remaining: ~45s" with countdown
- Show elapsed time as well

### Contextual Content Panel
While processing, show a rotating card (every 8s) with:
- **Industry benchmarks**: "Organizations in [Local Government] typically have 3-5 hierarchy levels in their strategic plans"
- **Tips**: "Tip: Plans with clearly defined metrics see 40% higher completion rates"
- **What's happening**: "Our AI is identifying goals, objectives, strategies, and KPIs in your document"
- **AchieveIt value props**: "AchieveIt helps track progress across all plan levels with automated reporting"

Content is tailored to the user's selected industry when available.

### Visual Design
- Full-width card replaces current status area during processing
- Animated progress bar with phase labels above it
- Below progress: rotating content card with fade transition
- Small collapsible "Activity Log" showing real-time status messages

## Implementation

### New Component: `ProcessingOverlay.tsx`
- Props: `currentPhase`, `progress` (0-100), `statusMessages`, `industry`, `orgName`, `estimatedTimeRemaining`
- Renders: segmented progress bar, phase labels, rotating tips, elapsed/remaining time
- Uses `useEffect` interval for tip rotation and time tracking

### Changes to `FileUploadStep.tsx`
- Replace `processingStatus` string with structured state: `{ phase, progress, messages[] }`
- Add `setProgress(phase, pct)` calls at each processing milestone:
  - PDF upload start → phase 1, 0%
  - PDF parsed → phase 1, 100%
  - Each AI chunk processed → phase 2, increment
  - Verification → phase 3
  - Each Vision batch → phase 4, increment
- Calculate estimated time from page count
- Render `<ProcessingOverlay>` instead of current inline status when `isLoading`

### Files
- **New**: `src/components/steps/ProcessingOverlay.tsx`
- **Modified**: `src/components/steps/FileUploadStep.tsx` — structured progress tracking, render overlay

