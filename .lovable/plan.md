

# Fix: Dynamic Schema Depth + Detected Level Names in Verification Modal

## Problems
1. **Schema caps at 4 levels** — `level4Item` has no `children`, so Claude physically cannot output items deeper than depth 4. The Boulder County doc has 5 levels (pillars → objectives → outcome KPIs → strategies → strategy KPIs).
2. **LevelVerificationModal shows stale default names** — The modal uses `useState(initialLevels)` which captures the value only on first mount. When `handleAIExtraction` calls `setLevels(levels)` and then opens the modal, React batches the state update so `state.levels` is still `DEFAULT_LEVELS` when the modal renders. Even if it weren't, the modal's internal state wouldn't update because `useState` ignores prop changes after mount.

## Changes

### 1. Extend schema nesting to 7 levels (`extract-plan-items/index.ts`, lines 271-293)
Add `level5Item`, `level6Item`, `level7Item` to the chain so Claude can nest items up to 7 levels deep. Only ~10 lines of schema definition change.

### 2. Fix LevelVerificationModal to sync with detected levels (`LevelVerificationModal.tsx`)
Add a `useEffect` that updates the modal's internal `levels` state whenever the `open` prop transitions to `true`, ensuring it picks up the AI-detected level names and count instead of stale defaults.

### 3. Pass detected levels directly to modal (`Index.tsx`, lines 83-87)
In `handleAIExtraction`, pass the detected levels directly as a separate prop or store them so the modal receives the correct levels before opening. The simplest fix: store the AI-detected levels in a ref or pass them as the `levels` prop to the modal, and use a `key` or `useEffect` to reset internal state.

