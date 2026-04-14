

## Feature Flags + Feedback/Grading System

### Database Migration

Single SQL migration creating:

1. **`feature_flags` column** on `user_profiles` — `JSONB NOT NULL DEFAULT '{}'`
2. **`session_feedback` table** with columns per spec (id, session_id, user_id, expected/actual item counts, generated delta, ratings, time_saved, open_feedback, timestamps, unique constraint)
3. **RLS policies** — users manage own feedback, admins read all
4. **Validation trigger** instead of CHECK constraints for rating range (1-5), per project guidelines

### Files to Create

| File | Purpose |
|------|---------|
| `src/components/plan-optimizer/FeedbackDialog.tsx` | Modal with 5 form fields: expected item count (number input + auto-delta), hierarchy rating (1-5 button group), overall rating (1-5 button group), time saved (dropdown), open feedback (textarea). Upserts to `session_feedback`. Pre-fills if existing feedback found. |
| `src/pages/admin/FeedbackPage.tsx` | Admin table of all feedback with columns: Date, User, Document, Org, Expected/Actual/Delta, Hierarchy Rating, Overall Rating, Time Saved. Summary stats banner (averages, count). Sortable columns, date range filter. Joins `session_feedback` → `processing_sessions` → `user_profiles`. |

### Files to Modify

| File | Change |
|------|--------|
| `src/hooks/useAuth.ts` | Fetch `feature_flags` from `user_profiles`, expose as `featureFlags: Record<string, boolean>` in return value |
| `src/components/steps/PlanOptimizerStep.tsx` | Add `featureFlags` and `user` to props. Add "Rate This Import" button next to Export (gated by `featureFlags.showFeedback`). Renders `FeedbackDialog`. Button text changes to "Edit Feedback" when feedback exists. Pass `actualItemCount` from initial extraction (not edited count). |
| `src/pages/Index.tsx` | Pass `featureFlags` and `user` down to `PlanOptimizerStep` |
| `src/pages/admin/UsersPage.tsx` | Add feature flag toggles (Show Feedback, Show Re-import) per user row. Update `user_profiles.feature_flags` on toggle. |
| `src/pages/admin/SessionDetailPage.tsx` | Add "User Feedback" collapsible section at bottom. Query `session_feedback` for the session. Display ratings, counts, delta, time saved, open feedback, submitter info. Show "No feedback submitted" if none. |
| `src/pages/admin/AdminLayout.tsx` | Add "Feedback" nav item with `MessageSquare` icon, route `/admin/feedback` |
| `src/App.tsx` | Add `/admin/feedback` route pointing to `FeedbackPage` |

### Technical Details

- **actual_item_count**: Sourced from `step_results.totalItems` (the AI's initial extraction count), not the current edited item array length
- **Upsert strategy**: `onConflict: 'session_id,user_id'` ensures one feedback per user per session, editable
- **Validation trigger**: Uses `BEFORE INSERT OR UPDATE` trigger to enforce `hierarchy_rating` and `overall_rating` between 1-5, avoiding CHECK constraint issues
- **No edge function changes** — all feedback CRUD is client-side via Supabase SDK

