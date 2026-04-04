

# Optional Auth Infrastructure (Email/Password, Not Enforced)

## Summary
Add email/password authentication that is entirely optional. Anonymous users keep full access. Signed-in users get sessions tagged with their `user_id` and see only their own sessions.

## Database Migration

```sql
ALTER TABLE processing_sessions
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_processing_sessions_user_id
  ON processing_sessions(user_id);
```

## Files to Create

### `src/hooks/useAuth.ts`
Auth hook providing `user`, `loading`, `signIn`, `signUp`, `signOut`. Uses `onAuthStateChange` listener set up before `getSession()` per best practices.

### `src/components/LoginPage.tsx`
Simple login/signup form:
- Toggle between "Sign In" and "Create Account" modes
- Email + password fields with basic validation
- Error message display
- "Continue without signing in" link that calls a callback to go back to sessions
- On successful auth, navigates back to sessions view

## Files to Modify

### `src/pages/Index.tsx`
- Import and call `useAuth()` to get `user`, `loading`, `signIn`, `signUp`, `signOut`
- Add `activeView` state option: `'sessions' | 'wizard' | 'login'`
- When `activeView === 'login'`, render `<LoginPage>` with auth callbacks
- Pass `user` to `Header` and `RecentSessionsPage`
- In `ensureSessionId`: include `user_id: user?.id ?? null` in the upsert payload

### `src/components/Header.tsx`
- Add `user` and `onSignOut` and `onSignIn` props (all optional)
- If user is signed in: show truncated email + "Sign Out" button instead of "Log In" link
- If user is not signed in: "Sign In" link calls `onSignIn` callback (navigates to login view)

### `src/components/RecentSessionsPage.tsx`
- Accept optional `userId` prop
- If `userId` is provided: filter query with `.eq('user_id', userId)`
- If `userId` is null/undefined: show all sessions (current behavior)

## Auth Configuration
- Enable auto-confirm for email signups (since the prompt says "No email verification required for now")
- Use `cloud--configure_auth` tool to set this

## What Does NOT Change
- No RLS changes — current permissive policies stay
- No protected routes — everything accessible
- No admin panel changes
- No edge function changes
- No SSO/OAuth

