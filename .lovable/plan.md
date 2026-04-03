

# Make Logo Clickable to Return Home

## Change
Make the AchieveIt logo in the `Header` component clickable to navigate back to the sessions/landing page from any step.

## Approach
- `Header.tsx` accepts an optional `onHomeClick` callback prop
- Wrap the logo `<a>` (currently linking to achieveit.com) — change behavior: when `onHomeClick` is provided, clicking the logo calls `onHomeClick` instead of opening achieveit.com. If no prop is passed, keep the external link behavior as fallback.
- `Index.tsx` passes `onHomeClick={() => { setActiveView('sessions'); setCurrentStep(0); }}` to `Header`

## Files to Modify

| File | Change |
|------|--------|
| `src/components/Header.tsx` | Add `onHomeClick?: () => void` prop; use it on logo click instead of external link |
| `src/pages/Index.tsx` | Pass `onHomeClick` to `Header` that resets to sessions view |

