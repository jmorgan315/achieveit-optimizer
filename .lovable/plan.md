

# Fix Admin Access & Session Visibility

## Problem
1. `is_admin` is `false` for `jmorgan@achieveit.com` — wrong email was used in the migration.
2. All 5+ existing sessions have `user_id = NULL`. The Recent Sessions page filters `WHERE user_id = :currentUserId`, returning zero results.
3. The `handle_new_user` trigger was not created (DB shows no triggers), though this is a secondary concern since the fallback insert in `useAuth.ts` handles it.

## Fix

### 1. Database migration
Single migration to:
- Set `is_admin = true` for `jmorgan@achieveit.com`
- Backfill existing `NULL` user_id sessions to the only user (`ee58c766-cc3c-4196-a404-1ed9ebf3847d`)
- Re-create the `handle_new_user` trigger (it exists as a function but the trigger itself is missing)

```sql
UPDATE public.user_profiles SET is_admin = true WHERE email = 'jmorgan@achieveit.com';

UPDATE public.processing_sessions SET user_id = 'ee58c766-cc3c-4196-a404-1ed9ebf3847d' WHERE user_id IS NULL;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
```

### 2. No code changes needed
The existing `useAuth.ts` already reads `is_admin` from `user_profiles` and the `RecentSessionsPage` already filters by `user_id`. Once the data is fixed, both features will work.

## After the fix
- Sign out and sign back in (or refresh) to pick up the admin flag
- Recent Sessions will show all previously-created sessions
- The Admin link in the header will become visible

