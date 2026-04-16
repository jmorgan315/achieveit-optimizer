

## Plan: Invite Tracking, Status Badges, Resend + Fix useNavigate Bug

### Bug Fix (Critical)
**`src/hooks/useAuth.ts`**: `useNavigate()` is called inside `useEffect` (line 81 in previous version). Move it to top-level of the hook.

### 1. Database Migration

Add two columns to `user_profiles`:
```sql
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_login_at TIMESTAMPTZ;
```

No new table — audit entries go into the existing `user_activity_log` table using `activity_type = 'user_invited'` / `'invite_resent'` and `metadata = { target_email, target_user_id }`.

### 2. Edge Functions

**`invite-user/index.ts`**: After successful invite, set `invited_at = NOW()` on the user's profile and insert into `user_activity_log` with `activity_type: 'user_invited'`.

**`admin-user-actions/index.ts`**: Add `resend_invite` action that calls `adminClient.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo } })`, updates `invited_at`, and logs `invite_resent` to `user_activity_log`.

### 3. `src/hooks/useAuth.ts`

- Move `useNavigate()` to top of hook (bug fix)
- In `checkDomainAndProfile`, select `first_login_at` alongside existing fields
- If `first_login_at` is null, update it to `NOW()`

### 4. `src/pages/admin/UsersPage.tsx`

- Add `invited_at` and `first_login_at` to `UserProfile` interface
- Add "Status" column with colored badges:
  - **Active** (green) — `first_login_at` set
  - **Invited** (yellow) — `invited_at` set, no `first_login_at`
  - **Pending** (gray) — neither set
- Add "Resend Invite" dropdown item (Mail icon), visible only for "Invited" status users, calls `admin-user-actions` with `action: 'resend_invite'`

### Files changed

| File | Change |
|------|--------|
| Migration SQL | Add `invited_at`, `first_login_at` columns |
| `supabase/functions/invite-user/index.ts` | Set `invited_at`, log to `user_activity_log` |
| `supabase/functions/admin-user-actions/index.ts` | Add `resend_invite` action |
| `src/hooks/useAuth.ts` | Fix `useNavigate` bug, track `first_login_at` |
| `src/pages/admin/UsersPage.tsx` | Status column + Resend Invite action |

