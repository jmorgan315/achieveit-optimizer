CREATE TABLE public.admin_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id)
);

INSERT INTO public.admin_settings (key, value) VALUES 
  ('model_rates', '{"claude-opus-4-6": {"input": 15, "output": 75}, "claude-sonnet-4-20250514": {"input": 3, "output": 15}}');

ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage settings" ON public.admin_settings
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Authenticated read settings" ON public.admin_settings
  FOR SELECT TO authenticated
  USING (true);