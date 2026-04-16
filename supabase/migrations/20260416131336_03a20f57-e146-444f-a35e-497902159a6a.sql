
-- Tighten user_profiles: only super_admin can update all profiles
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.user_profiles;

CREATE POLICY "Super admins can update all profiles" ON public.user_profiles
FOR UPDATE TO authenticated
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));

-- Tighten admin_settings: only super_admin can manage (insert/update/delete)
DROP POLICY IF EXISTS "Admins manage settings" ON public.admin_settings;

CREATE POLICY "Super admins manage settings" ON public.admin_settings
FOR ALL TO authenticated
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));
