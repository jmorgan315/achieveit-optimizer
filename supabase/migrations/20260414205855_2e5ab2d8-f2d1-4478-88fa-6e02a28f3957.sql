
-- Drop existing broad policies
DROP POLICY IF EXISTS "Authenticated users insert page-images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users read page-images" ON storage.objects;

-- SELECT: only files belonging to user's own sessions
CREATE POLICY "Owner reads page-images"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'page-images'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.processing_sessions WHERE user_id = auth.uid()
    )
  );

-- INSERT: only into paths matching user's own sessions
CREATE POLICY "Owner inserts page-images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'page-images'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.processing_sessions WHERE user_id = auth.uid()
    )
  );
