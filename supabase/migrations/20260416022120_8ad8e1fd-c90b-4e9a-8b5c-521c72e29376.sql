
-- Part 1: General Feedback table
CREATE TABLE public.general_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  category TEXT NOT NULL,
  subject TEXT,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.general_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert own feedback" ON public.general_feedback
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins read all feedback" ON public.general_feedback
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

-- Part 3: Role column on user_profiles
ALTER TABLE public.user_profiles ADD COLUMN role TEXT NOT NULL DEFAULT 'user';

UPDATE public.user_profiles SET role = 'super_admin' WHERE is_admin = true AND email = 'jmorgan@achieveit.com';
UPDATE public.user_profiles SET role = 'admin' WHERE is_admin = true AND email != 'jmorgan@achieveit.com';

-- Update is_admin function to use role
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles WHERE id = _user_id AND role IN ('admin', 'super_admin')
  )
$$;

-- New is_super_admin function
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles WHERE id = _user_id AND role = 'super_admin'
  )
$$;

-- Update the prevent_admin_escalation trigger to also guard role changes
CREATE OR REPLACE FUNCTION public.prevent_admin_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    IF NOT public.is_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Only admins can change admin status';
    END IF;
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NOT public.is_super_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Only super admins can change user roles';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
