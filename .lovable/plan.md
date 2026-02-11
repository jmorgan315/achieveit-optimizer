

# UI/UX Improvements: 5 Fixes

## 1. Remove Drag Icon from Level Configuration Modal

**File**: `src/components/steps/LevelVerificationModal.tsx`

Remove the `GripVertical` icon and its import since drag-and-drop reordering is not supported. This eliminates the misleading visual affordance.

## 2. Prevent Deleting Levels That Have Items

**File**: `src/components/steps/LevelVerificationModal.tsx`

The modal needs to know which levels have items assigned. Pass the current `items` array as a prop. Before allowing deletion, check if any items have `levelDepth` matching the level being removed. If items exist at that level, disable the delete button and show a tooltip explaining why (e.g., "3 items are assigned to this level").

**Also update**:
- `src/pages/Index.tsx` -- pass `items` to `LevelVerificationModal`
- `src/components/steps/PlanOptimizerStep.tsx` -- pass `items` to the nested `LevelVerificationModal`

## 3. Move Navigation Buttons to a Sticky Top Bar

**Files**: All step components + new shared component

Currently, Back and Start Over buttons sit at the very bottom. For large plans with hundreds of items, users must scroll to find them. The fix:

- Create a **sticky action bar** that sits just below the wizard progress bar, visible at all times
- Move Back, Start Over, and Export into this bar
- Remove the duplicate bottom buttons from each step component

The sticky bar will contain:
- **Left side**: Back button (ghost style with arrow)
- **Center/Right**: Primary action (e.g., "Download AchieveIt Import File" on Review & Export)
- **Far right**: Start Over (destructive ghost, only on Review & Export)

This bar will be rendered in `Index.tsx` based on the current step, keeping it consistent across all steps. Each step component will no longer render its own navigation buttons.

**Files modified**:
- `src/pages/Index.tsx` -- add sticky action bar between WizardProgress and step content
- `src/components/steps/PlanOptimizerStep.tsx` -- remove bottom action buttons
- `src/components/steps/PathSelectorStep.tsx` -- remove bottom back button
- `src/components/steps/PeopleMapperStep.tsx` -- remove bottom back/continue buttons (continue moves to sticky bar)

## 4. Unlink "Plan Import Assistant" Text

**File**: `src/components/Header.tsx`

Currently, the logo AND "Plan Import Assistant" text are wrapped in a single `<a>` tag linking to achieveit.com. Restructure so:
- The `<img>` logo stays wrapped in the link
- The "Plan Import Assistant" text becomes a plain `<span>` outside the link, not clickable

## 5. Improve Error Messages

**Files**: `src/components/steps/FileUploadStep.tsx`, `src/components/steps/PlanOptimizerStep.tsx`

Replace technical/generic error messages with user-friendly explanations:

| Current Error | Improved Message |
|---|---|
| `"Failed to parse PDF"` | `"We couldn't read your PDF. The file may be corrupted or password-protected. Try re-saving it or using a different format."` |
| `"AI extraction failed"` | `"Our AI wasn't able to understand the document structure. This can happen with unusual formatting. Try copying the text into a plain text file and uploading that instead."` |
| `"Failed to get suggestion"` | `"We couldn't generate a metric suggestion right now. This is usually temporary -- please try again in a moment."` |
| `"AI rate limit reached..."` | `"We're processing too many requests right now. Please wait about 30 seconds and try again."` |
| Generic catch-all | `"Something unexpected went wrong. Please try again, and if the problem continues, try a different file format or contact support."` |

Add a helper function `getUserFriendlyError(error, context)` that maps technical errors to plain-language messages based on the error content and operation context (upload, extraction, suggestion, etc.).

## Files Summary

| File | Changes |
|---|---|
| `src/components/steps/LevelVerificationModal.tsx` | Remove GripVertical icon; add items-in-use check for delete |
| `src/pages/Index.tsx` | Pass items to LevelVerificationModal; add sticky action bar |
| `src/components/steps/PlanOptimizerStep.tsx` | Remove bottom action buttons; pass items to LevelVerificationModal |
| `src/components/steps/PathSelectorStep.tsx` | Remove bottom back button |
| `src/components/steps/PeopleMapperStep.tsx` | Remove bottom back/continue buttons |
| `src/components/Header.tsx` | Separate logo link from "Plan Import Assistant" text |
| `src/components/steps/FileUploadStep.tsx` | Add user-friendly error messages |

