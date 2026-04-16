

## Three Changes: General Feedback, Inline Toggles, Role System

This is a large, interconnected change set. Here's the plan broken into three parts.

---

### Part 1: General Feedback Button + Dialog + Admin View

**Database migration:**
- Create `general_feedback` table (id, user_id, category, subject, message, created_at)
- RLS: users insert own, admins read all

**New file: `src/components/GeneralFeedbackDialog.tsx`**
- Dialog with Category dropdown (Bug Report, Feature Request, General Feedback), Subject input, Message textarea (required), Submit button
- Inserts into `general_feedback` with `user_id = auth.uid()`

**Header.tsx changes:**
- Accept `featureFlags` prop
- When `featureFlags.showFeedback` is true, render a "Feedback" button (MessageSquare icon) that opens `GeneralFeedbackDialog`

**Index.tsx changes:**
- Pass `featureFlags` to `Header`

**FeedbackPage.tsx changes:**
- Add Tabs: "Import Feedback" (existing content) and "General Feedback" (new table)
- General Feedback tab: fetch from `general_feedback`, join user_profiles for email/name, display Date, User, Category, Subject, Message

---

### Part 2: Inline Toggles on Users Table

**UsersPage.tsx changes:**
- Add columns: Active (Switch), Show Feedback (Switch), Show Re-import (Switch) — inline on each row
- Each switch triggers an immediate `supabase.update()` on `user_profiles` for that user
- Keep the same toggles in the edit dialog too
- These inline toggles will be gated behind `super_admin` role (Part 3)

---

### Part 3: Replace `is_admin` with `role` Column

**Database migration:**
```sql
ALTER TABLE public.user_profiles ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
UPDATE public.user_profiles SET role = 'super_admin' WHERE is_admin = true AND email = 'jmorgan@achieveit.com';
UPDATE public.user_profiles SET role = 'admin' WHERE is_admin = true AND email != 'jmorgan@achieveit.com';
```

Update `is_admin()` function:
```sql
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = _user_id AND role IN ('admin', 'super_admin')) $$;
```

New `is_super_admin()` function:
```sql
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = _user_id AND role = 'super_admin') $$;
```

Keep `is_admin` column for now (derived from role, not actively written to).

**useAuth.ts changes:**
- Fetch `role` column instead of just `is_admin`
- Return `role` (string: 'user' | 'admin' | 'super_admin') alongside `isAdmin` (derived: role is admin or super_admin)
- Add `isSuperAdmin` derived boolean

**AdminGuard.tsx changes:**
- Still uses `isAdmin` — no change needed (admins + super_admins both pass)

**Header.tsx changes:**
- `isAdmin` prop still works (shows gear icon for both admin roles)

**UsersPage.tsx changes:**
- Role column shows Badge: "User", "Admin", or "Super Admin"
- Inline toggles (Active, feature flags) only enabled when current user is super_admin
- Edit dialog: role dropdown (User/Admin/Super Admin) only for super_admins
- Action menu (Edit, Reset Password, Delete, Invite) only for super_admins
- Regular admins see the table read-only

**SettingsPage.tsx changes:**
- Gate save/edit behind super_admin (read-only for regular admins)

**Edge functions (admin-user-actions, invite-user):**
- Change `is_admin` check to `role IN ('admin', 'super_admin')` — or better, check for `super_admin` since these are user management actions. Use the `is_super_admin()` pattern or query `role = 'super_admin'` directly.

**Index.tsx:**
- Pass `isSuperAdmin` where needed, or just continue passing `isAdmin` (both roles see admin gear icon)

---

### Files Summary

| File | Action |
|------|--------|
| Migration SQL | New table + role column + functions |
| `src/components/GeneralFeedbackDialog.tsx` | New |
| `src/components/Header.tsx` | Add featureFlags prop, feedback button |
| `src/hooks/useAuth.ts` | Return `role`, `isAdmin`, `isSuperAdmin` |
| `src/pages/Index.tsx` | Pass featureFlags to Header |
| `src/pages/admin/UsersPage.tsx` | Inline toggles, role badges, super_admin gating |
| `src/pages/admin/FeedbackPage.tsx` | Tabs for import + general feedback |
| `src/pages/admin/SettingsPage.tsx` | Super_admin gate for editing |
| `src/components/AdminGuard.tsx` | No change (isAdmin still works) |
| `supabase/functions/admin-user-actions/index.ts` | Check super_admin for user mgmt |
| `supabase/functions/invite-user/index.ts` | Check super_admin for invites |

