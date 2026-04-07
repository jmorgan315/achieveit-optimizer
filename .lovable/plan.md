

# Email/Password Authentication

Replace Microsoft OAuth with email/password sign-in, keeping the `@achieveit.com` domain restriction.

## Changes

### 1. `src/hooks/useAuth.ts`
- Remove `signInWithMicrosoft` function
- Add `signIn(email, password)` — calls `supabase.auth.signInWithPassword()`
- Add `signUp(email, password)` — validates `@achieveit.com` domain, then calls `supabase.auth.signUp()`
- Add `resetPassword(email)` — calls `supabase.auth.resetPasswordForEmail()`
- Keep existing `checkDomainAndProfile`, `signOut`, and admin/profile logic unchanged

### 2. `src/components/LoginPage.tsx`
- Replace Microsoft button with email + password form
- Add sign-in / sign-up toggle
- Add "Forgot password?" link
- Enforce `@achieveit.com` domain on the email field (client-side validation)
- Show appropriate error messages

### 3. `src/pages/Index.tsx`
- Update destructuring from `useAuth()` (remove `signInWithMicrosoft`, add `signIn`, `signUp`)
- Update `<LoginPage>` props to pass new callbacks

### 4. New: `src/pages/ResetPasswordPage.tsx`
- Form to enter new password after clicking reset link
- Calls `supabase.auth.updateUser({ password })`

### 5. `src/App.tsx`
- Add `/reset-password` route

### 6. Database migration
- Add trigger to auto-create `user_profiles` row on signup (so the manual insert in `useAuth` isn't needed and avoids race conditions)

### 7. Backend auth config
- Enable auto-confirm for email signups (so users don't need to verify email — since domain is already restricted to `@achieveit.com`)
  - *Or keep email verification if you prefer an extra security step*

