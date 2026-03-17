
-- Table: processing_sessions
CREATE TABLE public.processing_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  org_name TEXT,
  org_industry TEXT,
  document_name TEXT,
  document_size_bytes INTEGER,
  extraction_method TEXT,
  total_items_extracted INTEGER,
  total_api_calls INTEGER NOT NULL DEFAULT 0,
  total_input_tokens INTEGER NOT NULL DEFAULT 0,
  total_output_tokens INTEGER NOT NULL DEFAULT 0,
  total_duration_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress'
);

ALTER TABLE public.processing_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on processing_sessions"
  ON public.processing_sessions
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Table: api_call_logs
CREATE TABLE public.api_call_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id UUID NOT NULL REFERENCES public.processing_sessions(id) ON DELETE CASCADE,
  edge_function TEXT NOT NULL,
  step_label TEXT,
  model TEXT,
  request_payload JSONB,
  response_payload JSONB,
  input_tokens INTEGER,
  output_tokens INTEGER,
  duration_ms INTEGER,
  status TEXT,
  error_message TEXT
);

ALTER TABLE public.api_call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on api_call_logs"
  ON public.api_call_logs
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Index for fast lookups by session
CREATE INDEX idx_api_call_logs_session_id ON public.api_call_logs(session_id);
