## Diagnose row 6 cell layout for Tulane file

### What we know now (no fix yet)

- `parseSpreadsheetFile` (`src/utils/spreadsheet-parser.ts:75-90`) is the **single source** for `sheet.rows`. Both the classifier preview and the hierarchical parser consume the exact same array — there is no second read of the file.
- It calls `XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false })`. With `defval: null` empty cells *should* become `null` rather than be skipped, but the SheetJS library's row-array length is determined per-row by the rightmost defined cell — and merged-cell handling, phantom format-only cells, and shared-strings quirks can shift indices.
- Your external openpyxl read says: `0=Goals, 1=Objectives, 2=Strategies, 3=None, 4=Tactics`. If our SheetJS read agrees, the classifier is being fed the wrong column layout and is correctly classifying what it sees — meaning the bug is in **how we read the sheet**, not in the parser/classifier downstream.
- If our SheetJS read DISAGREES with openpyxl (e.g. shows `Tactics` at index 3), then the bug is downstream — possibly in `parseHierarchicalColumns` resolving the wrong column index because `implied_levels` from the classifier maps to a header-row position that differs from the data-row position.

The two libraries can disagree on column indexing because the Tulane file has merged cells (A1:U1, A2:C2, … A5:C5) above the header row. SheetJS's `!ref` bound and openpyxl's iteration handle merged-cell index drift differently.

### Diagnostic patch (server-side logging only)

Add one new `log_type: 'raw-row-snapshot'` to `parser_diagnostics` from inside `parseHierarchicalColumns` BEFORE any other logic runs. For the configured `header_row_index` and the next 2 data rows, log:

```
{
  sheetName,
  headerRowIndex,
  dataStartRow,
  totalColumnsInSheet: sheet.columnCount,
  rows: [
    {
      rowIndex,
      length: row.length,
      cells: [
        { idx: 0, raw: <value>, type: typeof, isNull: row[i]===null, hex: <hex of String(v)> },
        ... up to idx 15
      ]
    },
    ...
  ]
}
```

Why this is enough to settle the question:
- If `headerRow` has `Tactics` at idx 3 and `Resp. Office` at idx 4 → SheetJS agrees with Excel UI; openpyxl is wrong; the downstream parser is at fault.
- If `headerRow` has `null` (or `""`) at idx 3 and `Tactics` at idx 4 → SheetJS agrees with openpyxl; the read itself is the bug. Then we know to either (a) switch SheetJS options (`raw`, `range`, expand merged cells) or (b) post-process row arrays to re-align by the header row's real positions.
- The data-row snapshot tells us whether the **leaf cells in column D** (`1.1.1.1 Provide an annual…`) land at idx 3 or idx 4 in our parsed rows. That's what determines whether the resolved hierarchy column index actually points at the right data.

### Files to touch

- `src/utils/parsers/parseHierarchicalColumns.ts` — emit the new `raw-row-snapshot` log near the existing `entry` log; no behavior changes.
- `src/components/admin/ParserDiagnosticsCard.tsx` — render the new `raw-row-snapshot` payload (existing card already pretty-prints unknown payloads as JSON, so this may need only a label tweak).

No parser logic changes. No classifier changes. No fix proposals until the user re-uploads Tulane and shares the snapshot from the admin Parser Diagnostics panel.

### After data comes back

Two possible follow-up paths, decided by what the snapshot shows:

1. **SheetJS-read drift (idx 3 = null, idx 4 = Tactics).** Fix `parseSpreadsheetFile` — likely by reading with `range: ws['!ref']` explicitly normalized and/or padding each row to `columnCount` so cells stay column-aligned. May also need to expand merged cells via `XLSX.utils.decode_range` + `!merges` handling.
2. **Downstream resolution drift (header agrees with Excel UI but data rows misalign).** Fix is in `resolveHierarchyColumns` / how `implied_levels` map to indices when the classifier and the data rows have differently-shaped arrays.

We pick the right fix only after seeing the row 6 snapshot.