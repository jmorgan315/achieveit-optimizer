
## Plan: Store source documents for feedback debugging (revised)

Retain the original uploaded file alongside each session so admins can download it later when reviewing feedback. New private storage bucket, fire-and-forget upload, downloadable from two admin surfaces.

### Revisions from previous plan

- **Add `text/plain` to bucket MIME allowlist** so `.txt` uploads (already accepted by the file picker) actually land in storage instead of silently failing.
- **Confirmed call-site ordering**: in `UploadIdentifyStep.handleContinue`, the source upload fires immediately after the `processing_sessions` update that follows `ensureSessionId`. By that point the row exists with `user_id` populated (created by `ensureSessionId` with `user_id: auth.uid()`), so storage RLS passes.
- **Post-ship regression gate**: run the 40-page Chattanooga PDF and confirm 47 items, unchanged processing time, source file visible/downloadable from admin detail.

### 1. Database migration (new file in `supabase/migrations/`)

- Add `source_file_path TEXT` (nullable) to `processing_sessions`.
- Create private `source-documents` bucket: `public=false`, `file_size_limit=52428800` (50MB), allowed MIME types:
  - `application/pdf`
  - `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
  - `application/msword`
  - `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  - `application/vnd.ms-excel`
  - `text/csv`
  - `text/plain` ← added
- Storage RLS on `storage.objects`:
  - SELECT: owner via join to `processing_sessions.user_id` matching first folder segment of object name.
  - SELECT: admins (`is_admin(auth.uid())`).
  - INSERT: authenticated users into folders matching their own session ids.
  - No DELETE/UPDATE policy → implicit deny (service role only).

### 2. `src/components/steps/UploadIdentifyStep.tsx`

- Add `MAX_FILE_SIZE = 50 * 1024 * 1024` constant.
- In `handleFileSelect`: pre-upload size check. If `file.size > MAX_FILE_SIZE`, toast "File exceeds 50MB limit. Please upload a smaller file." and return without setting state.
- Add helper `uploadSourceDocument(file, sessionId)` that:
  - Builds path `${sessionId}/${file.name}`.
  - Calls `supabase.storage.from('source-documents').upload(path, file, { upsert: true, contentType: file.type })`.
  - On success, updates `processing_sessions.source_file_path = path`.
  - All errors caught and logged to `console.error('[source-upload] …')`. Never throws.
- In `handleContinue`, immediately after the `processing_sessions` update that follows `ensureSessionId` (so `user_id` is already on the row), invoke `uploadSourceDocument(uploadedFile, sid)` **without await** (fire-and-forget). Critical path proceeds unchanged for spreadsheet, text, and PDF branches.

### 3. `src/pages/admin/SessionDetailPage.tsx`

- Extend `Session` interface with `source_file_path: string | null`.
- Add `handleDownloadSource()`: calls `supabase.storage.from('source-documents').createSignedUrl(session.source_file_path, 300)`; opens signed URL in a new tab on success; toast error on failure.
- Render a "Download Source Document" button in the top header card (next to status badge or in the metadata grid). Disabled with tooltip "No source document stored (legacy session)" when `source_file_path` is null. Use `lucide-react` `Download` icon.

### 4. `src/pages/admin/FeedbackPage.tsx` (Import Signals tab)

- Extend the `processing_sessions` select on lines 89 and 115 to include `source_file_path`.
- Extend `FeedbackRow` interface with `source_file_path: string | null` and populate from session map in both code paths (regular feedback rows + reimport-only rows).
- In the Document column cell (line 312), render a small icon button next to the document name:
  - If `source_file_path` present: enabled `FileText` icon button, tooltip "Download source document", `onClick` (with `e.stopPropagation()` so it doesn't toggle the row) triggers the same signed-URL download flow.
  - If null: muted/disabled icon, tooltip "Source file not available".
- Use existing `Tooltip` from `@/components/ui/tooltip`.

### Files affected

| File | Change |
|------|--------|
| `supabase/migrations/<new>.sql` | Add column, bucket (incl. `text/plain`), RLS policies |
| `src/components/steps/UploadIdentifyStep.tsx` | 50MB pre-check + fire-and-forget upload helper after `user_id` is set |
| `src/pages/admin/SessionDetailPage.tsx` | Download Source Document button (header) |
| `src/pages/admin/FeedbackPage.tsx` | Source-doc download icon in Document column; include `source_file_path` in queries |

### Out of scope (explicitly unchanged)

- `page-images` bucket and its policies.
- Pipeline edge functions (`process-plan`, `classify-document`, `extract-plan-items`, `extract-plan-vision`, `audit-completeness`, `validate-hierarchy`).
- 250-page PDF blocker (still runs first).
- Re-import flow source storage (separate follow-up).
- Spreadsheet parser, auto-start/resume logic, accept string.

### Post-ship regression checks

1. Chattanooga 40-page PDF → 47 items, processing time unchanged, source file appears in admin detail and downloads via signed URL.
2. `.docx` round-trip → upload, store, download.
3. `.xlsx` round-trip → upload, store, spreadsheet import flow still completes; download works.
4. `.txt` round-trip → confirms `text/plain` MIME fix.
5. Oversized (>50MB) → blocked client-side with toast.
6. Legacy session → admin button disabled with correct tooltip; no crash.
7. Non-admin user → can download own source doc, RLS denies access to others.
