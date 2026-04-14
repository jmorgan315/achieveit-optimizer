
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
