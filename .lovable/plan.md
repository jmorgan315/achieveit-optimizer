

## Homepage Layout — Hero CTA + Recent Sessions Below

### Summary
Restructure `RecentSessionsPage` to put a centered hero CTA on top and move the sessions list into a secondary "Recent Imports" section below. Remove the current header row with title+button.

### Changes — `src/components/RecentSessionsPage.tsx`

**Remove:** The current `flex` header row containing the heading, subtitle, and "New Import" button (lines ~130-140).

**Add Hero Section (top):**
- Centered container (`max-w-xl mx-auto text-center`) with `py-8` desktop / `py-5` mobile
- Heading: "Plan Import Assistant" — `text-2xl` desktop, `text-xl` mobile
- Subheading: existing text, `text-muted-foreground`
- Large CTA button: `w-[300px]` desktop, `w-full` mobile, centered
- Helper text below button: "Upload a PDF, Word, or Excel file to get started" in `text-sm text-muted-foreground`

**Add Recent Imports Section (below hero):**
- Only rendered when `sessions.length > 0`
- "Recent Imports" heading — left-aligned, `text-lg font-semibold text-muted-foreground` with top border or spacing as divider
- Centered container (`max-w-3xl mx-auto`)
- Existing session cards rendered inside, unchanged
- Mobile: `px-4`, full-width cards

**Empty state:** Remove the current dashed empty-state card entirely. When no sessions exist, only the hero shows — no "Recent Imports" section, no empty-state message.

**Loading state:** Show spinner below the hero section (not instead of it).

**No changes to:** Card design, click handlers, delete/cancel logic, polling, StatusBadge, or formatRelativeTime.

### Responsive approach
- Use Tailwind responsive prefixes (`sm:`, `md:`) for padding/width differences
- Hero button: `w-full sm:w-[300px]`
- Hero padding: `py-5 sm:py-8`
- Heading: `text-xl sm:text-2xl`
- Sessions container: `px-4 sm:px-0 max-w-3xl mx-auto`

### Files
| File | Change |
|------|--------|
| `src/components/RecentSessionsPage.tsx` | Restructure layout as described above |

