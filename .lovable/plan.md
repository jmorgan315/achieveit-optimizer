

## Plan: Fix first_login_at Not Being Set for Invited Users

### Root Cause
The invite flow bypasses `useAuth` entirely (`ResetPasswordPage` is standalone). After password set, navigation to `/` may trigger a `PASSWORD_RECOVERY` replay in `onAuthStateChange`, causing an early return that skips `checkDomainAndProfile`. The `first_login_at` update never runs.

### Fix (3 changes)

**1. `src/pages/ResetPasswordPage.tsx` — Set `first_login_at` after password is set**
After successful `updateUser({ password })`, immediately call:
```ts
await supabase.from('user_profiles')
  .update({ first_login_at: new Date().toISOString() })
  .eq('id', (await supabase.auth.getUser()).data.user?.id);
```
This is the primary fix — catches invite users directly at the moment they complete onboarding.

**2. `src/hooks/useAuth.ts` — Don't skip profile check after PASSWORD_RECOVERY redirect**
Currently line 94-97 returns early. Change to: navigate to `/reset-password` but still fall through to `checkDomainAndProfile` so subsequent events (after user sets password and returns) aren't blocked. Also add `.then()` error logging to the `first_login_at` update call.

**3. Database migration — Backfill existing users**
```sql
UPDATE public.user_profiles
SET first_login_at = (
  SELECT MIN(created_at) FROM public.user_activity_log
  WHERE user_activity_log.user_id = user_profiles.id
    AND activity_type = 'login'
)
WHERE first_login_at IS NULL
  AND id IN (SELECT DISTINCT user_id FROM public.user_activity_log WHERE activity_type = 'login');
```
This fixes Edelmary and any other users who already logged in before this fix.

### Files changed

| File | Change |
|------|--------|
| `src/pages/ResetPasswordPage.tsx` | Update `first_login_at` after password set |
| `src/hooks/useAuth.ts` | Don't skip `checkDomainAndProfile` after PASSWORD_RECOVERY; add error handling |
| Migration SQL | Backfill `first_login_at` from activity log |

