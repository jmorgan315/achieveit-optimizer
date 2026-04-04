ALTER TABLE processing_sessions
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_processing_sessions_user_id
  ON processing_sessions(user_id);