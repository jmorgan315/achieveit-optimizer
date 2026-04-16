import { supabase } from '@/integrations/supabase/client';

export type ActivityType =
  | 'login'
  | 'session_start'
  | 'session_complete'
  | 'export'
  | 'feedback_submitted'
  | 'reimport_applied';

export async function logActivity(
  activityType: ActivityType,
  metadata: Record<string, unknown> = {},
) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await (supabase as any).from('user_activity_log').insert({
      user_id: user.id,
      activity_type: activityType,
      metadata,
    });
  } catch {
    // Fire-and-forget — never block the UI
  }
}
