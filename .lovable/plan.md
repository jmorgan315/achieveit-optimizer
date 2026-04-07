

# User Account Settings Page

## Overview
Add a self-service account settings page where any authenticated user can manage their profile (first/last name) and trigger a password reset.

## Changes

### 1. Database migration
- Split `full_name` into `first_name` and `last_name` columns on `user_profiles` (add new columns, migrate existing data, drop old column).
- Existing RLS policies already allow users to update their own profile, so no policy changes needed.

```sql
ALTER TABLE public.user_profiles ADD COLUMN first_name text;
ALTER TABLE public.user_profiles ADD COLUMN last_name text;

-- Migrate existing full_name data (split on first space)
UPDATE public.user_profiles
SET first_name = split_part(full_name, ' ', 1),
    last_name = CASE WHEN position(' ' in full_name) > 0
      THEN substring(full_name from position(' ' in full_name) + 1)
      ELSE NULL END
WHERE full_name IS NOT NULL;

ALTER TABLE public.user_profiles DROP COLUMN full_name;
```

- Update `handle_new_user()` trigger function to populate `first_name`/`last_name` instead of `full_name`.

### 2. New: `src/pages/AccountSettingsPage.tsx`
- Form with First Name and Last Name fields, pre-populated from `user_profiles`
- "Change Password" button that calls `supabase.auth.resetPasswordForEmail()` and shows a toast confirming the email was sent
- Save button to update `user_profiles` via Supabase client
- Clean layout with the standard Header component

### 3. Update `src/App.tsx`
- Add route: `/account` -> `AccountSettingsPage`

### 4. Update `src/components/Header.tsx`
- Make the user's display name clickable, linking to `/account`
- Add a small user icon or chevron to indicate it's interactive

### 5. Update `src/hooks/useAuth.ts`
- Adjust `checkDomainAndProfile` to read `first_name`/`last_name` instead of `full_name` (for display name fallback)

### 6. Update references to `full_name`
- `UsersPage.tsx` — display `first_name + last_name` in the users table
- `LoginPage.tsx` — if sign-up collects a name, split into first/last
- Any other references found via search

## Notes
- The existing `/reset-password` page already handles the password update flow, so we just need to trigger the reset email from the account page.
- The `user_profiles` RLS policy "Users can update own profile" already permits self-service updates with no additional migration.

