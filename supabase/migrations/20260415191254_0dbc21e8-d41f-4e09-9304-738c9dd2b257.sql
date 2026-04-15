
-- Add UPDATE policy for page-images bucket scoped to session owner
CREATE POLICY "Session owners can update own images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'page-images'
  AND EXISTS (
    SELECT 1 FROM public.processing_sessions ps
    WHERE ps.id::text = (storage.foldername(name))[1]
      AND ps.user_id = auth.uid()
  )
);

-- Add DELETE policy for page-images bucket scoped to session owner
CREATE POLICY "Session owners can delete own images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'page-images'
  AND EXISTS (
    SELECT 1 FROM public.processing_sessions ps
    WHERE ps.id::text = (storage.foldername(name))[1]
      AND ps.user_id = auth.uid()
  )
);
