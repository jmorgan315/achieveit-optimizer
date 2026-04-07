

# Microsoft OAuth — Sign in with Microsoft Only

## Overview

Replace email/password login with Microsoft OAuth via Supabase's Azure provider. Auth remains optional. Four files to modify.

## Files & Changes

### 1. `src/hooks/useAuth.ts`
- Remove `signIn` and `signUp` functions
- Add `signInWithMicrosoft` that calls `supabase.auth.signInWithOAuth({ provider: 'azure', options: { scopes: 'email profile openid', redirectTo: window.location.origin } })`
- Keep `user`, `loading`, `signOut`

### 2. `src/components/LoginPage.tsx`
- Complete rewrite — remove all email/password fields, form, mode toggle
- New props: `onSignInWithMicrosoft: () => Promise<void>`, `onSkip: () => void`
- Add Azure setup instructions as a comment block at top of file (Azure AD registration steps, redirect URI, client secret, Supabase provider config)
- UI: Card with Microsoft logo SVG button (white bg, dark text, Microsoft icon) + "Continue without signing in" link below
- Error state for when Azure isn't configured yet
- Loading spinner on the button while OAuth initiates

### 3. `src/pages/Index.tsx`
- Destructure `signInWithMicrosoft` instead of `signIn`/`signUp` from `useAuth()`
- Rewrite the `activeView === 'login'` block: pass `onSignInWithMicrosoft` and `onSkip` to LoginPage (remove `onSignIn`/`onSignUp`)
- Add `useEffect`: when `activeView === 'login'` and `user` becomes non-null (OAuth callback), auto-switch to `'sessions'`

### 4. `src/components/Header.tsx`
- Update the signed-in display: show `user.user_metadata?.full_name || user.user_metadata?.name || user.email` instead of just `user.email`
- No other changes needed (Sign In link already navigates to login view)

## What stays the same
- No backend/edge function changes
- No session creation, user_id tagging, or RLS changes
- No admin panel changes
- "Continue without signing in" preserves full anonymous access

## Technical Notes
- Supabase Azure provider must be manually configured in the dashboard before the OAuth flow works
- The comment block in LoginPage.tsx will document all manual Azure AD setup steps
- `signInWithOAuth` redirects to Microsoft — no tokens are handled client-side

