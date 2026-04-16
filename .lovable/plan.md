

## Plan: Export as XLSX + Accept CSV in Re-import

### Summary
Two changes: (1) Convert the export function to produce `.xlsx` files using SheetJS instead of CSV. (2) Update the re-import file picker to accept both `.xlsx` and `.csv`.

### Files to Modify

**1. `src/utils/exportToExcel.ts`**
- Add `import * as XLSX from 'xlsx'`
- Replace CSV string construction with SheetJS workbook creation:
  - Create workbook + worksheet from the headers + row data using `XLSX.utils.aoa_to_sheet`
  - Set column widths for readability (Name/Description wider)
  - Write workbook to array buffer with `XLSX.write(wb, { bookType: 'xlsx', type: 'array' })`
  - Download as blob with `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` MIME type
- Remove `escapeCSV` helper (no longer needed)
- Keep `formatDate` for M/D/YY formatting (same format the reimport parser expects)
- Filenames become `achieveit-plan-import.xlsx` and `achieveit-plan-extended-export.xlsx`

**2. `src/components/plan-optimizer/ReimportDialog.tsx`**
- Change file input `accept` from `.xlsx` to `.xlsx,.csv`
- Update helper text from "Choose an .xlsx file" to "Choose an .xlsx or .csv file"
- No parser changes needed — SheetJS `XLSX.read()` already handles both formats

### What stays unchanged
- `reimport-parser.ts` — SheetJS `read()` handles CSV natively, no code changes needed
- `reimport-diff.ts` — unchanged
- All other export/import logic

