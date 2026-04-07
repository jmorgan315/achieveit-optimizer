

# Enforce Login + Admin Role + Domain Restriction

## Overview

Remove anonymous access entirely. All users must sign in with Microsoft OAuth (`@achieveit.com` only). Add a `user_profiles` table with `is_admin` / `is_active` flags. Admin panel is gated behind `is_admin`. Non-admin users see no admin link.

## Database Migration

Create `user_profiles` table:

```sql
CREATE TABLE public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_profiles_email ON public.user_profiles(email);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "Users can read own profile"
  ON public.user_profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

-- Users can update their own profile (non-role fields only handled in app logic)
CREATE POLICY "Users can update own profile"
  ON public.user_profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid());

-- Allow insert for auto-creation on first sign-in
CREATE POLICY "Users can insert own profile"
  ON public.user_profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- Admins can read all profiles (for user management)
-- Using a security definer function to avoid recursion
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.user_profiles WHERE id = _user_id),
    false
  )
$$;

CREATE POLICY "Admins can read all profiles"
  ON public.user_profiles FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));
```

A commented-out SQL snippet will be provided for seeding the first admin after their first sign-in:
```sql
-- UPDATE public.user_profiles SET is_admin = true WHERE email = 'jonathan@achieveit.com';
```

## File Changes

### `src/hooks/useAuth.ts`
- Add `isAdmin` and `domainError` state
- After `user` is set, fetch `user_profiles` row; if missing, auto-create it
- Check `is_active` — if false, sign out immediately
- Set `isAdmin` from profile
- Add domain check: if `user.email` doesn't end with `@achieveit.com`, sign out and set `domainError`
- Return `{ user, isAdmin, loading, domainError, signInWithMicrosoft, signOut }`

### `src/components/LoginPage.tsx`
- Remove "Continue without signing in" link
- Add `domainError?: string` prop; display it as an alert when set
- Update subtitle to "Sign in with your AchieveIt Microsoft account to continue"

### `src/pages/Index.tsx`
- If `authLoading`, show a centered spinner
- If `!user && !authLoading`, always render the login page (remove sessions/wizard rendering for unauthenticated users)
- Remove `onSkip` prop from `LoginPage`
- Pass `domainError` to `LoginPage`
- Remove the `activeView === 'login'` view — login is now the default when not authenticated
- `user_id` in session creation: use `user.id` directly (no `?? null` fallback)
- Pass `isAdmin` to Header; conditionally show admin link
- `RecentSessionsPage`: always pass `userId={user.id}` (required, not optional)

### `src/components/RecentSessionsPage.tsx`
- Change `userId` prop from optional to required (`userId: string`)
- Remove the `if (userId)` conditional — always filter by `user_id`

### `src/components/Header.tsx`
- Add `isAdmin?: boolean` prop
- Only render the admin Settings link when `isAdmin` is true
- Remove the `onSignIn` prop/button (login is enforced, no manual sign-in trigger needed from header)

### `src/App.tsx`
- Wrap `/admin` routes with auth + admin check
- Create a small `AdminGuard` component that uses `useAuth()`, shows "Access Denied" if not admin, loading spinner if loading, login redirect if not authenticated

### `src/pages/admin/SessionsPage.tsx`
- Remove `user_id` filter — admins see all sessions
- Add a "User" column showing the session owner's email (join with `user_profiles` or display `user_id` with a separate lookup)

## What stays the same
- No edge function changes
- No changes to processing pipeline
- No changes to RLS on `processing_sessions` or `api_call_logs` (future improvement)
- Microsoft OAuth configuration (already built)

