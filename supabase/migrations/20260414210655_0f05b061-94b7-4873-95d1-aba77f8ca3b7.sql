
-- 1. Add feature_flags column to user_profiles
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS feature_flags JSONB NOT NULL DEFAULT '{}';

-- 2. Create session_feedback table
CREATE TABLE public.session_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.processing_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  expected_item_count INTEGER,
  actual_item_count INTEGER NOT NULL,
  item_count_delta INTEGER GENERATED ALWAYS AS (actual_item_count - expected_item_count) STORED,
  hierarchy_rating INTEGER,
  overall_rating INTEGER,
  time_saved TEXT,
  open_feedback TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, user_id)
);

-- 3. Enable RLS
ALTER TABLE public.session_feedback ENABLE ROW LEVEL SECURITY;

-- 4. RLS policies
CREATE POLICY "Users manage own feedback"
  ON public.session_feedback
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins read all feedback"
  ON public.session_feedback
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- 5. Validation trigger for ratings
CREATE OR REPLACE FUNCTION public.validate_feedback_ratings()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.hierarchy_rating IS NOT NULL AND (NEW.hierarchy_rating < 1 OR NEW.hierarchy_rating > 5) THEN
    RAISE EXCEPTION 'hierarchy_rating must be between 1 and 5';
  END IF;
  IF NEW.overall_rating IS NOT NULL AND (NEW.overall_rating < 1 OR NEW.overall_rating > 5) THEN
    RAISE EXCEPTION 'overall_rating must be between 1 and 5';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_feedback_ratings_trigger
  BEFORE INSERT OR UPDATE ON public.session_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_feedback_ratings();

-- 6. Create updated_at function if not exists
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 7. Updated_at trigger
CREATE TRIGGER update_session_feedback_updated_at
  BEFORE UPDATE ON public.session_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
