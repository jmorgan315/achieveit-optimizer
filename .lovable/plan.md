

# Admin User Management

Add a user management page to the admin area for viewing, editing, and inviting users.

## Changes

### 1. New: `src/pages/admin/UsersPage.tsx`
- Table listing all `user_profiles` (email, full_name, is_admin, is_active, created_at)
- Toggle buttons to activate/deactivate users and grant/revoke admin
- "Invite User" button that opens a dialog to enter an email address

### 2. New: `supabase/functions/invite-user/index.ts`
- Edge function that uses the Supabase Admin API (`auth.admin.createUser`) to create a user with a generated temporary password and send them an invite/reset-password email
- Validates `@achieveit.com` domain server-side
- Only callable by admins (checks `is_admin` via service role)

### 3. Database migration
- Add RLS policy on `user_profiles` allowing admins to UPDATE any profile (for toggling is_admin / is_active)
- Current policies only allow users to update their own profile

### 4. `src/pages/admin/AdminLayout.tsx`
- Add "Users" nav item linking to `/admin/users`

### 5. `src/App.tsx`
- Add `/admin/users` route under the admin layout

### Technical notes
- The invite flow uses `supabase.auth.admin.inviteUserByEmail()` in the edge function (requires service role key, already available as a secret)
- Invited users receive an email with a magic link to set their password
- The `handle_new_user` trigger will auto-create their profile row

