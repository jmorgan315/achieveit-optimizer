UPDATE public.user_profiles SET is_admin = true WHERE email = 'jmorgan@achieveit.com';

UPDATE public.processing_sessions SET user_id = 'ee58c766-cc3c-4196-a404-1ed9ebf3847d' WHERE user_id IS NULL;