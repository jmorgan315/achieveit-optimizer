
ALTER TABLE public.processing_sessions
  ADD COLUMN IF NOT EXISTS current_step text NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS step_results jsonb;

ALTER PUBLICATION supabase_realtime ADD TABLE public.processing_sessions;
