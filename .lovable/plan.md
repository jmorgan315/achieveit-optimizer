

## Plan: Show Sessions with Re-imports Even Without Feedback

### Problem
The Import Feedback tab fetches from `session_feedback` first, then enriches with session data. Sessions that were re-imported but never graded don't have a `session_feedback` row, so they never appear.

### Solution
After fetching feedback rows, also fetch `processing_sessions` that have `step_results->reimport` set but are NOT already represented in the feedback results. Merge these as "reimport-only" rows with empty feedback fields.

### File to Modify

**`src/pages/admin/FeedbackPage.tsx`**

**Data fetching changes (inside the `useEffect`):**

1. Keep the existing `session_feedback` fetch as-is
2. After building the feedback rows, fetch reimport-only sessions:
   ```sql
   SELECT id, user_id, org_name, document_name, step_results, created_at
   FROM processing_sessions
   WHERE step_results->>'reimport' IS NOT NULL
     AND id NOT IN (...feedbackSessionIds)
   ```
   - Use `.not('step_results->reimport', 'is', null)` filter via Supabase JS
   - Exclude session IDs already covered by feedback rows
3. For each reimport-only session, create a `FeedbackRow` with:
   - `id`: session id (used as key)
   - `session_id`: session id
   - `user_id`: from session
   - All feedback fields null/0: `expected_item_count: null`, `actual_item_count: 0`, `item_count_delta: null`, `hierarchy_rating: null`, `overall_rating: null`, `time_saved: null`, `open_feedback: null`
   - `created_at`: from session's `step_results.reimport.timestamp` (or session `created_at`)
   - `reimport`: extracted from `step_results.reimport`
   - Enrich with org_name, document_name, user_email from the session/profile data

4. Merge reimport-only rows into the main `rows` array

**FeedbackRow type update:**
- Add `hasFeedback: boolean` field to distinguish rows with actual ratings from reimport-only rows

**Table display:**
- For reimport-only rows (no feedback), render `—` for all feedback columns (ratings, delta, time saved, etc.)
- Re-import columns show data as normal
- The row is still expandable — shows reimport details even without open_feedback text

**Stats updates:**
- "Total Feedback" stat card label could become "Total Sessions" or stay but clarify: feedback + reimport-only count
- Reimport stats already work since they check `r.reimport` presence
- Average ratings should only count rows where `hasFeedback` is true (already filtered by `!= null`)

**Tab count:**
- Update the tab label count to reflect the merged total

