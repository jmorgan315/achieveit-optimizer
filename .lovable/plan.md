

## Plan: Ship spreadsheet completion + cancelled status (with .eq fix)

Approved fix going in. One correction applied per user: all status guards use `.eq('status', 'in_progress')`, never `.is(...)`. `.is()` is PostgREST syntax for NULL/boolean checks and would silently fail to match the string `'in_progress'`.

### Change 1 — Harden completion at mapping confirm

`src/components/steps/SpreadsheetImportStep.tsx` `handleApplyMapping` (lines ~135–158):
- Replace `.upsert(..., { onConflict: 'id' })` with `.update(...).eq('id', sessionId)`.
- `await` it before `onComplete(...)`.
- On error: `toast.error('Failed to mark session complete')`, log, but still call `onComplete` (don't block user).
- Remove `[ssdebug:final]` log block (17c cleanup).

### Change 2 — Safety-net completion (with .eq fix)

`src/pages/Index.tsx` `handleSpreadsheetComplete` (line ~483), after `setItems(...)`:

```ts
supabase
  .from('processing_sessions')
  .update({
    status: 'completed',
    extraction_method: 'spreadsheet',
    total_items_extracted: items.length,
  })
  .eq('id', state.sessionId)
  .eq('status', 'in_progress')   // ← .eq, not .is
  .then(({ error }) => {
    if (error) console.error('[Session] Safety-net completion failed:', error);
  });
```

Remove `[ssdebug:state] handleSpreadsheetComplete received` log (17c cleanup).

### Change 3 — Cancel on Start Over (spreadsheet path only, with .eq fix)

`src/pages/Index.tsx` `handleStartOver` (line ~152), before resetting React state:
- If `state.sessionId` exists AND the current session was a spreadsheet import (`state.extractionMethod === 'spreadsheet'` or filename matches `.xlsx|.xls|.csv`):

```ts
supabase
  .from('processing_sessions')
  .update({ status: 'cancelled', current_step: 'cancelled' })
  .eq('id', state.sessionId)
  .eq('status', 'in_progress')   // ← .eq guard, never demote completed
  .then(({ error }) => {
    if (error) console.error('[Session] Cancel on Start Over failed:', error);
  });
```

Do NOT add this to the PDF/Word path.

### Change 4 — Realign Recent Sessions cancel to `'cancelled'`

`src/components/RecentSessionsPage.tsx` `handleCancel` (line ~175):
- Change update payload `{ status: 'failed', current_step: 'cancelled', pipeline_run_id: null }` → `{ status: 'cancelled', current_step: 'cancelled', pipeline_run_id: null }`.
- Update local state mirror on line ~181 to `'cancelled'`.

### Change 5 — Admin Sessions filter + badge

`src/pages/admin/SessionsPage.tsx`:
- Add `<SelectItem value="cancelled">Cancelled</SelectItem>` to Status dropdown (line ~113–119).
- `statusVariant` (line ~84): return `'outline'` for `'cancelled'`.
- Add `<SelectItem value="spreadsheet">Spreadsheet</SelectItem>` to Method dropdown.

### Change 6 — Cleanup of 17c instrumentation

Remove all `[ssdebug:*]` console logs added in prompt 17c:
- `src/utils/spreadsheet-parser.ts` — `[ssdebug:detect]` and `[ssdebug:gen]` logs
- `src/components/steps/SpreadsheetImportStep.tsx` — `[ssdebug:final]` log
- `src/pages/Index.tsx` — `[ssdebug:state]` log in `handleSpreadsheetComplete`
- `src/hooks/usePlanState.ts` — `[ssdebug:state]` log in `setItems`

### Files affected

| File | Change |
|------|--------|
| `src/components/steps/SpreadsheetImportStep.tsx` | Awaited `.update()`; remove ssdebug log |
| `src/pages/Index.tsx` | Safety-net completion + Start Over cancel (both with `.eq`); remove ssdebug log |
| `src/components/RecentSessionsPage.tsx` | Cancel writes `'cancelled'` not `'failed'` |
| `src/pages/admin/SessionsPage.tsx` | Cancelled status filter + variant; Spreadsheet method filter |
| `src/utils/spreadsheet-parser.ts` | Remove ssdebug logs |
| `src/hooks/usePlanState.ts` | Remove ssdebug log |

### Out of scope

- No `beforeunload` handler.
- No backfill of existing stuck `in_progress` rows.
- No `completed_at` column.
- No PDF/Word pipeline changes.
- No spreadsheet parser logic changes.
- No status CHECK/enum migration (column is plain `text`).

### Regression gates (all 7 must pass)

1. **Chattanooga PDF** — completes via `process-plan`, `status='completed'`, items populated.
2. **Operational Plan .xlsx** — mapping confirm → 685 items, `status='completed'`, `extraction_method='spreadsheet'`, admin shows 685 Items.
3. **DRAFT Initiative 1 .xlsx** — mapping confirm → 24 items, `status='completed'`.
4. **Abandoned spreadsheet** — upload .xlsx, reach mapping, click Start Over → DB row flips to `'cancelled'`. Admin filter "Cancelled" surfaces it.
5. **Recent Sessions cancel** — Cancel Import on running PDF row → DB row flips to `'cancelled'` (not `'failed'`).
6. **No demotion** — Start Over from a `completed` Review & Export screen does NOT change status (the `.eq('status','in_progress')` guard).
7. **17c log cleanup** — no `[ssdebug:*]` lines in console after fresh import.

### Report-back

- Lines changed per file.
- All 7 gates pass (especially gate 4 cancelled write, gate 6 no-demotion, gate 7 cleanup).
- Confirm `.eq('status','in_progress')` used at both guard sites (Change 2 and Change 3), zero `.is(...)` instances.

