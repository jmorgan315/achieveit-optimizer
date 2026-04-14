-- Drop existing public storage policies on page-images
DROP POLICY IF EXISTS "Allow service role delete on page-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow service role insert on page-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read access on page-images" ON storage.objects;

-- Make bucket private
UPDATE storage.buckets SET public = false WHERE id = 'page-images';

-- INSERT restricted to authenticated users
CREATE POLICY "Authenticated users insert page-images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'page-images');

-- SELECT restricted to authenticated users
CREATE POLICY "Authenticated users read page-images"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'page-images');

-- Fix user_profiles self-escalation
DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;
CREATE POLICY "Users can update own profile"
  ON public.user_profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND is_admin = (SELECT up.is_admin FROM public.user_profiles up WHERE up.id = auth.uid())
  );

-- Remove Realtime from processing_sessions
ALTER PUBLICATION supabase_realtime DROP TABLE public.processing_sessions;