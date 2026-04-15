
DROP POLICY "Users can update own profile" ON public.user_profiles;

CREATE POLICY "Users can update own profile"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (
  id = auth.uid()
  AND is_admin = false
  AND is_active = (SELECT up.is_active FROM public.user_profiles up WHERE up.id = auth.uid())
  AND feature_flags = (SELECT up.feature_flags FROM public.user_profiles up WHERE up.id = auth.uid())
);
