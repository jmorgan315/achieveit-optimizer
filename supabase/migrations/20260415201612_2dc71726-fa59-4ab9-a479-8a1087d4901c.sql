-- Attach the existing prevent_admin_escalation function as a trigger on user_profiles
CREATE TRIGGER prevent_admin_escalation
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_admin_escalation();