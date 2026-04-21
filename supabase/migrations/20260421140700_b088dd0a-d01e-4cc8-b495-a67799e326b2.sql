-- Add column for source file path
ALTER TABLE public.processing_sessions
ADD COLUMN source_file_path TEXT;

-- Create private source-documents bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'source-documents',
  'source-documents',
  false,
  52428800,
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'text/plain'
  ]
);

-- RLS: owner can SELECT their own
CREATE POLICY "Users can read own source documents"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'source-documents'
  AND EXISTS (
    SELECT 1 FROM public.processing_sessions
    WHERE processing_sessions.id::text = (storage.foldername(name))[1]
    AND processing_sessions.user_id = auth.uid()
  )
);

-- RLS: admins can SELECT all
CREATE POLICY "Admins can read all source documents"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'source-documents'
  AND public.is_admin(auth.uid())
);

-- RLS: authenticated users can INSERT to their own session folders
CREATE POLICY "Users can upload source documents to own sessions"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'source-documents'
  AND EXISTS (
    SELECT 1 FROM public.processing_sessions
    WHERE processing_sessions.id::text = (storage.foldername(name))[1]
    AND processing_sessions.user_id = auth.uid()
  )
);