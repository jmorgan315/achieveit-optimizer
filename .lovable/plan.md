

## Fix 3 Database Security Issues

Single SQL migration covering all three fixes.

### 1. Lock down `processing_sessions`

- Drop the permissive "Allow all operations" policy
- Add 4 scoped policies for authenticated users (SELECT, INSERT, UPDATE, DELETE) using `user_id = auth.uid()`
- Add admin SELECT-all policy using `is_admin(auth.uid())`
- Edge functions use service role key (verified in `process-plan` and `_shared/logging.ts`), so they bypass RLS

### 2. Fix `user_profiles` INSERT policy

- Drop existing "Users can insert own profile" policy
- Re-create with `WITH CHECK (id = auth.uid() AND is_admin = false AND is_active = true)` to prevent self-escalation

### 3. Lock down `api_call_logs`

- Drop the permissive "Allow all operations" policy
- Add authenticated SELECT policy scoped to own sessions: `session_id IN (SELECT id FROM processing_sessions WHERE user_id = auth.uid())`
- Add admin SELECT-all policy
- No INSERT/UPDATE/DELETE policies for authenticated users (only service role writes)

### Frontend impact

All frontend queries already filter by `user_id` or session ownership. Admin pages are behind `AdminGuard` and the admin user will match the admin policies. No frontend code changes needed.

### Migration SQL

```sql
-- 1. processing_sessions
DROP POLICY "Allow all operations on processing_sessions" ON processing_sessions;

CREATE POLICY "Users select own sessions" ON processing_sessions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Admins select all sessions" ON processing_sessions
  FOR SELECT TO authenticated USING (is_admin(auth.uid()));

CREATE POLICY "Users insert own sessions" ON processing_sessions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own sessions" ON processing_sessions
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users delete own sessions" ON processing_sessions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- 2. user_profiles INSERT fix
DROP POLICY "Users can insert own profile" ON user_profiles;

CREATE POLICY "Users can insert own profile" ON user_profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() AND is_admin = false AND is_active = true);

-- 3. api_call_logs
DROP POLICY "Allow all operations on api_call_logs" ON api_call_logs;

CREATE POLICY "Users select own logs" ON api_call_logs
  FOR SELECT TO authenticated
  USING (session_id IN (SELECT id FROM processing_sessions WHERE user_id = auth.uid()));

CREATE POLICY "Admins select all logs" ON api_call_logs
  FOR SELECT TO authenticated
  USING (is_admin(auth.uid()));
```

### Files modified

| File | Change |
|------|--------|
| New SQL migration | All 3 security fixes above |

No frontend code changes required.

