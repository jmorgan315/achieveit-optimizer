
ALTER TABLE public.user_profiles ADD COLUMN first_name text;
ALTER TABLE public.user_profiles ADD COLUMN last_name text;

UPDATE public.user_profiles
SET first_name = split_part(full_name, ' ', 1),
    last_name = CASE WHEN position(' ' in full_name) > 0
      THEN substring(full_name from position(' ' in full_name) + 1)
      ELSE NULL END
WHERE full_name IS NOT NULL;

ALTER TABLE public.user_profiles DROP COLUMN full_name;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  raw_name text;
BEGIN
  raw_name := COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name');
  INSERT INTO public.user_profiles (id, email, first_name, last_name)
  VALUES (
    NEW.id,
    NEW.email,
    split_part(raw_name, ' ', 1),
    CASE WHEN position(' ' in COALESCE(raw_name, '')) > 0
      THEN substring(raw_name from position(' ' in raw_name) + 1)
      ELSE NULL END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
