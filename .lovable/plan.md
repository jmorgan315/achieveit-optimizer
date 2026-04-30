## Diagnostic-only patch: `[ssphase4b] row-scan` instrumentation

Goal: capture exactly what the parser sees when processing the original Tulane file, including byte-level hex of skipped rows. **No parser logic changes.** Logs only. Will be removed after diagnosis.

### File touched (only one)
- `src/utils/parsers/parseHierarchicalColumns.ts`

### What gets added

1. Local diagnostic state (declared just before the row loop):
   - `diagRowsScanned`, `diagRowsAllEmpty`, `diagRowsSkippedNoLeaf`, `diagRowsParsed` counters
   - `diagSkippedSamples: Array<...>` capped at 5 entries
   - `diagPerRoot: Map<rootNormalizedKey, {rows, leaves}>`
   - `toHex(s)` helper: `Array.from(s).map(c => c.charCodeAt(0).toString(16).padStart(2,'0')).join(' ')`

2. Pre-loop log:
   ```ts
   console.log('[ssphase4b] row-scan start:', JSON.stringify({
     sheet, pattern, hierarchySignal, dataStartRow,
     totalRows, rowsToScan,
     resolvedColumnIndices, resolvedLevels,
   }));
   ```

3. Inside the row loop (no behavior changes — same skip points):
   - Increment `diagRowsScanned` after `Array.isArray` check.
   - When fully-empty row skip triggers → bump `diagRowsAllEmpty`, continue.
   - Compute `rawValues` and `filled` exactly as today.
   - Replace today's `if (leafDepthIdx < 0) continue;` and `if (!filled[leafDepthIdx]) continue;` with assignments to a `skipReason` string:
     - Pattern B: `'pattern-B: no raw hierarchy cell on row'`
     - Pattern C: `'pattern-C: deepest level empty after inheritance'`
   - If `skipReason` set:
     - Bump `diagRowsSkippedNoLeaf`.
     - If `diagSkippedSamples.length < 5`, push:
       ```ts
       {
         rowIndex: r,
         reason: skipReason,
         leafDepthIdx,
         rawValues,
         filled,
         rawHex: rawValues.map(toHex),
         filledHex: filled.map(toHex),
         fullRowFirst12: row.slice(0, 12).map(c => c == null ? '' : String(c)),
         fullRowFirst12Hex: row.slice(0, 12).map(c => toHex(c == null ? '' : String(c))),
       }
       ```
     - `continue;`
   - Else bump `diagRowsParsed` and tally per-root:
     ```ts
     const rootKey = normalizeWhitespace(filled[0] || '').toLowerCase() || '<no-root>';
     ```
     `diagPerRoot[rootKey].rows++; .leaves++;` (one leaf per parsed row in Pattern C; close enough as a sanity check for B).

   Important: control flow stays identical — same rows skipped, same rows parsed, same items produced. Only added counters and one `continue` path now branches via `skipReason` instead of two inline `continue`s.

4. Post-loop logs (just before existing `parsed:` log):
   ```ts
   console.log('[ssphase4b] row-scan summary:', JSON.stringify({
     sheet: sheet.name,
     rowsScanned: diagRowsScanned,
     rowsAllEmpty: diagRowsAllEmpty,
     rowsSkippedNoLeaf: diagRowsSkippedNoLeaf,
     rowsParsed: diagRowsParsed,
   }));
   console.log('[ssphase4b] row-scan skipped-samples:', JSON.stringify(diagSkippedSamples));
   console.log('[ssphase4b] root-summary:', JSON.stringify(
     Array.from(diagPerRoot.entries()).map(([root, s]) => ({ root, ...s }))
   ));
   ```

5. Existing `parsed:` and `hierarchy:` logs stay as-is.

### Out of scope
- No change to `normalizeWhitespace`, `pathKey`, dedupe, or leaf logic.
- No change to `SpreadsheetImportStep.tsx` or any other file.
- No change to classifier or upstream parsing.

### Expected diagnostic value
- If `rowsSkippedNoLeaf` is large for the original file (and small for the round-tripped export), confirms rows are being silently dropped.
- `skipped-samples` `rawHex` / `filledHex` will reveal `0xa0` (NBSP), `0x09` (tab), `0x200b` (zero-width space), or other Unicode whitespace landing in the deepest hierarchy column.
- `root-summary` confirms whether Goal 1/Goal 2 rows are reaching the parser at all (vs being absent from `sheet.rows`, which would point upstream to `spreadsheet-parser.ts`).

### After validation
Once we identify the cause from the logs, the real fix proposal will follow (likely: extend `cellAt`'s emptiness check or `normalizeWhitespace` to treat Unicode whitespace as whitespace — but only after the logs prove it).