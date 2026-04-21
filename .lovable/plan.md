
## Plan: Fix 2-children-per-parent cap in spreadsheet import (revised)

Replace the over-eager column-header guard at `src/utils/spreadsheet-parser.ts:279` with an exact-match check against the **local `colHeaders`** array (confirmed; not `section.columnHeaders`). Apply the same fix to the parallel guard at line 310 in the headerless code path so the same bug doesn't survive in a different shape.

### Variable name confirmation

Read lines 255–310 of `spreadsheet-parser.ts`. Inside `detectGenericPattern` there is no `section` / `currentSection` object — the column headers for the section currently being walked live in a local `const colHeaders = rows[i].map(...).filter(...)` built on lines 269–271 (and on lines 301–303 for the headerless variant). The fix references `colHeaders` directly. No ambiguity.

### Change A — line 279 (sectioned path)

Today:
```ts
const dataRowStart = i;
while (i < rows.length && !isLikelySectionHeader(rows[i], avgCols)) {
  const filled = rows[i].filter(c => c != null && String(c).trim() !== '');
  if (filled.length === 0) { i++; continue; }
  if (isLikelyColumnHeaderRow(rows[i]) && i > dataRowStart + 1) break;
  i++;
}
```

After:
```ts
// Normalize this section's column headers once for exact-match comparison.
const headerSet = new Set(
  colHeaders.map(h => h.trim().toLowerCase()).filter(h => h.length > 0)
);

const dataRowStart = i;
while (i < rows.length && !isLikelySectionHeader(rows[i], avgCols)) {
  const filled = rows[i].filter(c => c != null && String(c).trim() !== '');
  if (filled.length === 0) { i++; continue; }

  // Only break if this row IS a repeat of THIS section's column-header row:
  // every non-empty cell exactly matches one of the section's headers
  // (case- and whitespace-insensitive). Never break when the section has no headers.
  if (headerSet.size > 0 && i > dataRowStart + 1) {
    const allCellsAreHeaders = filled.every(c =>
      headerSet.has(String(c).trim().toLowerCase())
    );
    if (allCellsAreHeaders) break;
  }
  i++;
}
```

### Change B — line 310 (headerless first-section path)

Same shape: the guard inside the `while (i < rows.length)` loop starting at line 307 also calls `isLikelyColumnHeaderRow(rows[i])` to decide when to stop consuming data rows. Replace it with the same exact-match check against the local `colHeaders` from lines 301–303. (Will read lines 300–340 during the edit to confirm the exact line and apply the identical pattern.)

### What stays untouched

- `isLikelyColumnHeaderRow` helper itself (lines 127–133) — may have other callers; leave it.
- `isLikelySectionHeader`.
- Metrics / `colIndexMap` / `refSection` logic — explicitly deferred.
- `generatePlanItems`, mapping UI, multi-tab merge.
- AI extraction path (PDF/Word).
- Source-document storage feature.

### Known residual risk (acknowledged, not engineered around)

The exact-match guard can still false-positive if a future spreadsheet has an interior data row where every non-empty cell coincidentally equals a column-header string of that same section. Vastly narrower than the original bug (which fired on any short multi-cell row). The DRAFT template, Chattanooga, and Operational Plan don't have such rows. Logging this here so a future "lost items" report points at this as the first suspect.

### Regression gates (all must pass before ship)

1. **Chattanooga PDF (40 pages)** → 47 items via AI path. Spreadsheet parser is untouched on that code path; gate is for safety.
2. **Operational Plan .xlsx (20 sheets)** → 685 items, no drops, no duplicates.
3. **DRAFT_State_Reporting_Template.xlsx, Initiative 1 tab** → 24 items:
   - 6 Stage parents (Stage 0 – Stage 5)
   - 17 Checkpoint children with correct parents:
     - Stage 0 → 0.1, 0.2
     - Stage 1 → 1.1, 1.2
     - **Stage 2 → 2.1, 2.2, 2.3, 2.4** (critical)
     - Stage 3 → 3.1, 3.2, 3.3
     - Stage 4 → 4.1, 4.2, 4.3
     - Stage 5 → 5.1, 5.2, 5.3
   - 1 "Metrics" section header (no children — unchanged, deferred)

Pull the original `.xlsx` from the `source-documents` bucket for the affected session for gate 3 so the test runs on the exact bytes that surfaced the bug.

### Files affected

| File | Change |
|------|--------|
| `src/utils/spreadsheet-parser.ts` | Two guards replaced with exact-match check against local `colHeaders` (≈16 lines net across both sites) |

### Report-back after ship

- Exact lines changed in `spreadsheet-parser.ts` (both sites).
- Gate results: 47 / 685 / 24.
- One-line confirmation that nothing else in the parser was modified.
