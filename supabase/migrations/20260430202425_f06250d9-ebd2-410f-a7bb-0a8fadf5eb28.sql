CREATE TABLE public.parser_diagnostics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.processing_sessions(id) ON DELETE CASCADE,
  sheet_name TEXT,
  parser_name TEXT NOT NULL,
  log_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_parser_diagnostics_session ON public.parser_diagnostics(session_id, created_at);

ALTER TABLE public.parser_diagnostics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read parser diagnostics"
ON public.parser_diagnostics FOR SELECT
TO authenticated
USING (is_admin(auth.uid()));

CREATE POLICY "Authenticated users can insert their own parser diagnostics"
ON public.parser_diagnostics FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.processing_sessions
    WHERE processing_sessions.id = session_id
    AND processing_sessions.user_id = auth.uid()
  )
);