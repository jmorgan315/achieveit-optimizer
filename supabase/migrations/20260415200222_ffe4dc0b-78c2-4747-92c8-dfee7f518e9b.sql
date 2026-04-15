
CREATE TABLE public.user_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  activity_type TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_activity_created ON public.user_activity_log(created_at DESC);
CREATE INDEX idx_user_activity_user ON public.user_activity_log(user_id);

ALTER TABLE public.user_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read all activity"
ON public.user_activity_log FOR SELECT TO authenticated
USING (public.is_admin(auth.uid()));

CREATE POLICY "Users insert own activity"
ON public.user_activity_log FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());
