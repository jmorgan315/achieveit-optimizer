

# Mobile Responsiveness Audit (375px viewport)

## Findings by Screen

### 1. RecentSessionsPage — Minor issues

**Header row (line 82):** `flex items-center justify-between` — at 375px with `px-4`, the title "Plan Import Assistant" (text-2xl) plus subtitle plus "New Import" button will be very tight. The h1 and subtitle div won't truncate, so the button could get squeezed or the layout could overflow.

**Fix:** On small screens, stack the header: title/subtitle on top, button below (full-width or right-aligned). Use `flex-col sm:flex-row` with `gap-4`.

**Session cards (line 117):** `flex items-center gap-4 py-4 px-5` — the horizontal layout with FileText icon + text block + right-side count works, but long document names combined with org name + timestamp could get cramped. The `truncate` on document name and `min-w-0` on the flex child handle this correctly. The status badge on the same line as the doc name (`flex items-center gap-2`) could push content — badge has `shrink-0` behavior by default. This is borderline OK but could clip.

**Fix:** Consider wrapping the status badge below the doc name on mobile: `flex-wrap` on the name+badge row, or stack them.

**Verdict: Mostly OK, header needs stacking.**

---

### 2. UploadIdentifyStep (Screen 1) — OK

**Layout (line 356):** `max-w-2xl mx-auto` with `px-4` from parent — fine at 375px.

**Drag-and-drop zone (line 410):** `p-12` padding is generous on mobile — the zone will be ~311px wide internally with large padding. The content is centered and stacks vertically. This works but `p-12` is wasteful on mobile — could use `p-6 sm:p-12`.

**Org fields:** Standard `Input` and `Select` components, full-width within card. No issues.

**File selected state (line 455):** `flex items-center justify-between` with file name — long filenames could push the X button off. The file name div doesn't have `truncate`. 

**Fix:** Add `truncate` to the filename `<p>` (line 461) and `min-w-0` to its parent div.

**Verdict: Functional, minor padding and truncation fixes.**

---

### 3. ScanResultsStep (Screen 2) — OK

**Grid (line 420):** `grid grid-cols-1 lg:grid-cols-2` — correctly falls back to single column below 1024px. No issues.

**Plan level inputs (line 316):** Each level row is `flex items-center gap-2` with a `w-24` label, input, and delete button. At 375px minus card padding (~40px), that's ~335px for the row. The `w-24` (96px) label + gap + delete button (28px) leaves ~195px for the input. Tight but functional.

**Fix:** The label `w-24` could be reduced to `w-20` on mobile, or stack the label above the input. Minor — current layout works.

**Org match card:** Single-column layout, buttons are `flex-1` and fixed. Fine.

**Verdict: Good — single-column fallback works well.**

---

### 4. WizardProgress (Stepper) — Problem

**5 step labels at 375px:** The stepper uses `whitespace-nowrap` on labels (line 58). The step titles are:
- "Upload & Identify" (~100px)
- "Review & Configure" (~110px)  
- "Process" (~45px)
- "Map People" (~70px)
- "Review & Export" (~95px)

Total text width ~420px, plus dots and spacing. At 375px this **will overflow** or compress dots together with overlapping text. The `max-w-3xl` container and `flex justify-between` will force items into the 375px width, but `whitespace-nowrap` prevents wrapping — labels will overlap each other.

**Fix:** Abbreviate titles on mobile:
- "Upload" / "Configure" / "Process" / "People" / "Export"
- Use responsive classes: `<span className="hidden sm:inline">Upload & Identify</span><span className="sm:hidden">Upload</span>`
- OR hide labels entirely on mobile, showing only dots (the dots are only 16px each, 5 dots fit easily)

**Verdict: Broken — labels overlap at 375px. Needs abbreviation or hiding.**

---

### 5. ProcessingOverlay (Screen 3) — Minor issues

**Step indicators (line 143-165):** 5 step chips in a `flex items-center gap-1` row. Labels already have `hidden sm:inline` (line 161) — on mobile, only icons show. This is correct and works.

**Progress bar:** Full-width, fine.

**Tip card (line 176):** Fixed `h-[5.5rem]` with `line-clamp-2` on text — works at any width.

**Header (line 128):** `flex items-center gap-3` with brain icon + text + elapsed time. The `flex-1` on text div handles overflow. Fine.

**Verdict: Already handles mobile well via `hidden sm:inline`.**

---

### 6. PlanOptimizerStep (Review & Export) — Multiple issues

**View mode toggle + controls (line 452-492):** `flex items-center justify-between` containing:
- Left: view mode switch + labels (~200px)
- Right: AI Confidence switch + "N Need Review" button + Export button (~350px)

At 375px, this row will **definitely overflow**. The right side alone exceeds the viewport width.

**Fix:** Stack into two rows on mobile. Top row: view toggle. Bottom row: confidence toggle + export. Use `flex-col sm:flex-row gap-2`.

**Stats bar (line 495):** `grid grid-cols-5 gap-4` — at 375px, each card gets ~55px wide. The `text-2xl font-bold` numbers and "Missing Owners" labels won't fit in 55px columns.

**Fix:** Use `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` or `grid-cols-3 sm:grid-cols-5`, letting the grid wrap. Or use a horizontal scroll container.

**Coverage grid (line 588):** `grid grid-cols-3 gap-4` — at 375px, each cell ~100px. The `text-3xl font-bold` + label fits but is tight. Borderline OK.

**Metric dialog (line 740):** `grid grid-cols-2 gap-3` — fine in a dialog.

**Verdict: Broken — toolbar overflows, stats grid is unusable at 5 columns.**

---

## Summary of Issues

| Screen | Severity | Issue |
|--------|----------|-------|
| RecentSessionsPage | Minor | Header title + button don't stack on narrow screens |
| UploadIdentifyStep | Minor | Drop zone `p-12` wasteful; filename lacks `truncate` |
| ScanResultsStep | OK | Single-column fallback works correctly |
| **WizardProgress** | **Broken** | 5 `whitespace-nowrap` labels overlap at 375px |
| ProcessingOverlay | OK | Already uses `hidden sm:inline` for step labels |
| **PlanOptimizerStep** | **Broken** | Toolbar controls overflow; `grid-cols-5` stats bar unusable |

## Proposed Fixes

### Fix 1: WizardProgress — Shorten labels on mobile
Add short titles and use responsive display classes. Show abbreviated labels (`Upload`, `Configure`, `Process`, `People`, `Export`) below `sm`, full titles at `sm+`.

### Fix 2: PlanOptimizerStep — Responsive toolbar
Wrap the view toggle + controls row using `flex-wrap` or `flex-col` below `sm`. Move Export and AI Confidence to a second row.

### Fix 3: PlanOptimizerStep — Responsive stats grid
Change `grid-cols-5` to `grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5` so cards wrap on mobile.

### Fix 4: RecentSessionsPage — Stack header on mobile
Change header to `flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`. Make "New Import" button full-width on mobile or right-aligned.

### Fix 5: UploadIdentifyStep — Minor tweaks
Reduce drop zone padding on mobile: `p-6 sm:p-12`. Add `truncate` to filename text.

### Files to Modify

| File | Changes |
|------|---------|
| `src/components/WizardProgress.tsx` | Responsive step labels (abbreviated on mobile) |
| `src/components/steps/PlanOptimizerStep.tsx` | Responsive toolbar wrapping, stats grid cols |
| `src/components/RecentSessionsPage.tsx` | Header stacking on mobile |
| `src/components/steps/UploadIdentifyStep.tsx` | Drop zone padding, filename truncation |

