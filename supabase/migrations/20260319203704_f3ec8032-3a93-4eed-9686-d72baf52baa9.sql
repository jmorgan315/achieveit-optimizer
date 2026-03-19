ALTER TABLE public.processing_sessions
  ADD COLUMN document_type text,
  ADD COLUMN classification_result jsonb;