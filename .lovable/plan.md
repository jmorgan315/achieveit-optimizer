

## Plan: Rotate carets on admin Collapsible sections

### Findings

- **Admin sidebar** (`AdminLayout.tsx`) is a flat nav with no expandable groups — no carets to fix there.
- **Real targets** are 4 `Collapsible` triggers on `SessionDetailPage.tsx` whose `ChevronDown` icons stay static when expanded:
  1. Line 154 — Document Classification card header
  2. Line 452 — Re-import "View Details" trigger
  3. Line 483 — API Call Timeline rows (explicitly mentioned by user)
  4. Line 557 — Results Preview header
- One trigger (line 178, "Full Classification JSON") already rotates correctly using a tracked `expanded` state — leave it as-is.
- `FeedbackPage.tsx` (line 308) swaps between `ChevronDown` and `ChevronRight` icons, which is a different (also valid) pattern — leave it as-is.

### Approach

Radix `CollapsibleTrigger` automatically gets `data-state="open" | "closed"`. The same Tailwind pattern already used in `src/components/ui/accordion.tsx` works perfectly:

```
[&[data-state=open]>svg]:rotate-180
```

Combined with `transition-transform duration-200` on the chevron itself, this gives a smooth 180° rotation when the section opens — without needing `useState` or controlled open props.

### Changes (single file: `src/pages/admin/SessionDetailPage.tsx`)

For each of the 4 triggers above:
- Add `[&[data-state=open]_svg.chevron-caret]:rotate-180` to the `CollapsibleTrigger`'s className (using a marker class to target only the caret, not other inner SVGs like Tabs/Badge icons).
- Add `chevron-caret transition-transform duration-200` to the corresponding `ChevronDown` className.

Result: clicking any of these headers smoothly flips the caret 180°, then back when collapsed. No state tracking, no re-render overhead.

### Files affected

| File | Change |
|------|--------|
| `src/pages/admin/SessionDetailPage.tsx` | Add rotation + transition classes to 4 Collapsible triggers and their chevron icons |

### Out of scope (no change)
- `AdminLayout.tsx` sidebar (no expandable groups)
- `FeedbackPage.tsx` row toggle (uses icon-swap pattern, working as designed)
- `ClassificationCard` inner JSON trigger (already rotates correctly)
- Any non-admin Collapsible usage

