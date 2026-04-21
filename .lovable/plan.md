

## Plan: Instrument the spreadsheet import end-to-end and capture evidence

Approved with the upgrade: section #4 (app-state handoff logging) is required, not optional. No functional changes — instrumentation only. After capturing logs, report back with evidence before any fix.

### What I now suspect (to be confirmed by logs, not by code)

I cannot prove the cap location from static reading alone. Two hypotheses survive review and the logs need to discriminate:

1. **Parser still drops rows** — either the 17b fix isn't actually in the deployed bundle for the user's session, or `isLikelySectionHeader` (line 135–141) is misclassifying one of `2.3 / 3.3 / 4.3 / 5.3` because of cell-count edge cases (trailing empty cells, whitespace).
2. **`generatePlanItems` builds `colIndexMap` from the wrong section** — line 481 picks the first section with column headers as the global reference. On this template, the **Metrics** section is detected first (row ~7-8) with headers `["#", "Metric", "Current Value", "As of Date"]`. Stage sections have headers `["Checkpoint", "Yes/No", "Attachment(s)"]`. If `colIndexMap` only knows Metrics columns, every Stage row's `getColumnValue("Checkpoint")` returns `''`, which would skip all checkpoints — but it doesn't, which means the user's mapped column name happens to collide with a Metrics header (likely `"Metric"` at column index 1 lining up with the description column in Stage rows). That collision could produce exactly the truncation pattern if some Stage rows have nulls in column index 1. Needs evidence.

The logs below are designed to discriminate cleanly between these.

### Section 1 — Parser logging (`detectGenericPattern`, `src/utils/spreadsheet-parser.ts`)

Add a single namespaced logger and emit:

- One `[ssdebug:detect] section.start` per detected section: `{ sheet, headerText, headerRowIndex, columnHeaderRowIndex, colHeaders }`.
- One `[ssdebug:detect] consume.row` per row inside the inner data loop: `{ sheet, section: headerText, rowIndex: i, row, filledCount: filled.length }`.
- One `[ssdebug:detect] section.end` when the inner loop exits: `{ sheet, section: headerText, dataRowStart, dataRowEnd, dataRowCount, stopReason: 'isSectionHeader' | 'headerSetMatch' | 'eof', stopRow }`.
- For the 5 suspect rows specifically (any row whose first cell starts with `2.3 | 2.4 | 3.3 | 4.3 | 5.3`), additionally log `isLikelySectionHeader(row, avgCols)` and `isLikelyColumnHeaderRow(row)` decisions plus the headerSet contents at the moment the decision is made.

This proves whether Stage 2/3/4/5 sections actually capture all checkpoint rows or stop early.

### Section 2 — Generator logging (`generatePlanItems`, same file)

- Log `[ssdebug:gen] colIndexMap.built` once: `{ refSection: refSection?.headerText, colIndexEntries: [...colIndexMap.entries()] }`.
- Log `[ssdebug:gen] section.in` per section: `{ section: section.headerText, dataRowStart, dataRowEnd, dataRowCount }`.
- Inside the generic-branch row loop (lines 709–760), log `[ssdebug:gen] row.decision` for every row: `{ section, rowIndex, row, nameColMapped: nameCol, resolvedName: name, skippedReason }` where `skippedReason` is one of `'no-row' | 'empty' | 'no-name' | null`.
- Log `[ssdebug:gen] item.out` per emitted item: `{ section, rowIndex, name, parentId, levelDepth }`.
- Log `[ssdebug:gen] section.out` per section: `{ section, emittedCount }`.

This proves whether the generator receives all rows but drops them (e.g. empty `name` from `colIndexMap` mismatch) versus the parser already dropping them.

### Section 3 — App-state handoff logging (REQUIRED)

In `src/components/steps/SpreadsheetImportStep.tsx` `handleApplyMapping`, immediately before line 160 `onComplete(...)`:

```ts
console.log('[ssdebug:final] before onComplete', {
  totalItems: items.length,
  byParent: items.reduce((acc, it) => {
    const k = it.parentId ?? 'ROOT';
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>),
  names: items.map(i => ({ order: i.order, depth: i.levelDepth, name: i.name, parentId: i.parentId })),
});
```

In `src/pages/Index.tsx` `handleSpreadsheetComplete` (line 483) — first line of the function:

```ts
console.log('[ssdebug:state] handleSpreadsheetComplete received', {
  totalItems: items.length,
  names: items.map(i => i.name),
});
```

In `src/hooks/usePlanState.ts` `setItems` (line 30) — first line of the callback:

```ts
console.log('[ssdebug:state] usePlanState.setItems', {
  totalItems: items.length,
  names: items.map(i => i.name),
});
```

These three logs prove whether the cap is upstream of state (parser/generator) or downstream (state setter, level recalculation, review screen).

### How to run and capture

1. Hard-refresh the preview to bust any cached bundle.
2. Open DevTools console; filter by `[ssdebug:`.
3. Pull the user's exact `.xlsx` from the `source-documents` storage bucket for the affected session, upload through the wizard, select `Initiative 1` only, accept default mapping (or apply the user's mapping if known), click through to generation.
4. Copy the full filtered console output.

### Evidence to deliver back (before any fix)

- For each of Stage 0..5: the `section.end` log line (`dataRowCount`, `stopReason`).
- For each of the 5 suspect rows (2.3, 2.4, 3.3, 4.3, 5.3): the `consume.row` line if present, OR the absence noted explicitly with the stop reason of the enclosing section.
- `colIndexMap.built` log contents.
- For each Stage section: `section.in` (rows in) vs `section.out` (items out).
- `[ssdebug:final] before onComplete` total count and parent histogram.
- `[ssdebug:state] handleSpreadsheetComplete received` total.
- `[ssdebug:state] usePlanState.setItems` total.

The cap is the first place where the count drops from 24 to 20.

### What stays untouched

- No logic changes anywhere.
- No parser fix.
- No Metrics section changes.
- 17b's exact-match guard at lines 275–292 stays.
- AI/PDF path untouched.
- Source-document storage feature untouched.

### Cleanup

The `[ssdebug:*]` logs are temporary. They will be removed in the same PR as the eventual functional fix, once the evidence is captured and the fix is approved.

### Files to be modified

| File | Change |
|------|--------|
| `src/utils/spreadsheet-parser.ts` | Add `[ssdebug:detect]` and `[ssdebug:gen]` console logs |
| `src/components/steps/SpreadsheetImportStep.tsx` | Add `[ssdebug:final] before onComplete` log |
| `src/pages/Index.tsx` | Add `[ssdebug:state] handleSpreadsheetComplete received` log |
| `src/hooks/usePlanState.ts` | Add `[ssdebug:state] usePlanState.setItems` log |

