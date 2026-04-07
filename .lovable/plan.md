

## Display User's Name in Header & Collect Name at Signup

### Problem
The header currently shows the user's email. We want to show their first+last name instead, and collect that name during signup.

### Changes

#### 1. Update `src/components/LoginPage.tsx`
- Add `firstName` and `lastName` state fields
- Show First Name and Last Name inputs when in `signup` mode
- Pass first/last name to `onSignUp` callback

#### 2. Update `src/hooks/useAuth.ts`
- Change `signUp` signature to accept `(email, password, firstName, lastName)`
- Pass name as `user_metadata` in `signUp()` call: `data: { full_name: firstName + ' ' + lastName }`
- Expose `displayName` from the hook by fetching `first_name`/`last_name` from `user_profiles` during `checkDomainAndProfile`
- Store `displayName` in hook state and return it

#### 3. Update `src/components/Header.tsx`
- Accept a `displayName` prop (or derive from user profile)
- Show `displayName` instead of `user.email` in the top-right user link
- Fall back to email if no name is set

#### 4. Update `src/pages/Index.tsx` (and any other consumers)
- Pass `displayName` from `useAuth()` to `<Header>`
- Update `LoginPage` usage to pass the updated `onSignUp` with name params

### Technical Detail
- The DB trigger `handle_new_user()` already splits `full_name` from `raw_user_meta_data` into `first_name`/`last_name` columns, so passing metadata at signup will auto-populate the profile.
- No database migration needed.

