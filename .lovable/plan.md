

## Admin Enhancements: User Management Actions + Activity Log

### Part 1: User Management Actions (UsersPage.tsx)

**a) Deactivate/Reactivate + Delete User**
- Inactive users already get signed out via `useAuth` — just need visual indicators
- Add grayed-out styling and "Inactive" badge on deactivated rows
- Add "Delete User" behind an `AlertDialog` confirmation — calls a new edge function `admin-user-actions` that uses `supabase.auth.admin.deleteUser(userId)` with service role key (deleting from auth cascades to `user_profiles`)
- The Active toggle already exists in the table

**b) Reset Password**
- Add a "Reset Password" button per user row (in an actions dropdown menu)
- Calls the same new `admin-user-actions` edge function with `action: 'reset_password'` — uses `supabase.auth.admin.generateLink({ type: 'recovery', email })` or `resetPasswordForEmail` with service role
- Shows success toast

**c) Edit User Profile**
- Add an "Edit" button per row opening a dialog with: first_name, last_name, email (read-only), is_admin toggle, feature flag toggles
- Saves to `user_profiles` via Supabase client (admin RLS policy already allows updates)

**UI approach**: Replace the current inline toggles with a compact actions column containing a dropdown menu (Edit, Reset Password, Delete). Move admin/active/flag toggles into the Edit dialog to reduce table width.

### Part 2: User Activity Log

**Database migration** (single SQL file):
- `user_activity_log` table with id, user_id, activity_type, metadata (JSONB), created_at
- Indexes on `created_at DESC` and `user_id`
- RLS: admin-only SELECT, authenticated INSERT (own user_id only)

**Frontend logging** — add `logActivity()` helper function, called at:
- Sign-in success (in `useAuth` `onAuthStateChange`)
- Session start (in Index.tsx on processing begin)
- Session complete (in Index.tsx on pipeline finish)
- Export click (in Index.tsx `handleExport`)
- Feedback submission (in `FeedbackDialog.tsx`)

**Admin Activity Page** (`src/pages/admin/ActivityPage.tsx`):
- Table: Date/Time, User, Activity Type, Details
- Filters: user, activity type, date range
- Summary stats: logins today, active users this week, total exports
- Joins `user_activity_log` with `user_profiles` for display names

### Files to Create

| File | Purpose |
|------|---------|
| `supabase/functions/admin-user-actions/index.ts` | Edge function handling reset_password and delete_user admin actions |
| `src/pages/admin/ActivityPage.tsx` | Activity log admin page |
| `src/utils/logActivity.ts` | Helper to insert into `user_activity_log` |

### Files to Modify

| File | Change |
|------|--------|
| `src/pages/admin/UsersPage.tsx` | Rewrite with actions dropdown (Edit dialog, Reset Password, Delete confirmation), inactive row styling |
| `src/pages/admin/AdminLayout.tsx` | Add "Activity" nav item |
| `src/App.tsx` | Add `/admin/activity` route |
| `src/hooks/useAuth.ts` | Log 'login' activity on sign-in |
| `src/pages/Index.tsx` | Log session_start, session_complete, export activities |
| `src/components/plan-optimizer/FeedbackDialog.tsx` | Log feedback_submitted activity |

### Database Migration (single file)

```sql
-- user_activity_log table
CREATE TABLE public.user_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  activity_type TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_user_activity_created ON public.user_activity_log(created_at DESC);
CREATE INDEX idx_user_activity_user ON public.user_activity_log(user_id);

ALTER TABLE public.user_activity_log ENABLE ROW LEVEL SECURITY;

-- Admins read all
CREATE POLICY "Admins read all activity"
ON public.user_activity_log FOR SELECT TO authenticated
USING (public.is_admin(auth.uid()));

-- Users insert own activity
CREATE POLICY "Users insert own activity"
ON public.user_activity_log FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());
```

### Edge Function: admin-user-actions

Handles two actions via JSON body `{ action, userId, email }`:
- `reset_password`: calls `adminClient.auth.admin.generateLink({ type: 'recovery', email })` then sends reset email
- `delete_user`: calls `adminClient.auth.admin.deleteUser(userId)` — cascades to `user_profiles`

Same admin verification pattern as `invite-user` (verify caller JWT, check `is_admin` via service role).

