
-- Create a trigger function that prevents non-admins from changing is_admin
CREATE OR REPLACE FUNCTION public.prevent_admin_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If is_admin is being changed, only allow if the current user is already an admin
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    IF NOT public.is_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Only admins can change admin status';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Attach trigger to user_profiles
CREATE TRIGGER enforce_admin_escalation
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_admin_escalation();
