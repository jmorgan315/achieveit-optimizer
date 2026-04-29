ALTER TABLE public.processing_sessions
  ADD COLUMN IF NOT EXISTS layout_classification jsonb,
  ADD COLUMN IF NOT EXISTS layout_classified_at timestamptz;