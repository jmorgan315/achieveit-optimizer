

## Plan: Fix RLS Policy Blocking Admin Profile Updates

### Root Cause
The "Users can update own profile" RLS policy has `is_admin = false` hardcoded in its `WITH CHECK`. This means **any user with `is_admin = true` is blocked from updating their own profile** — even just first/last name. The save call is already correct (only sends `first_name`, `last_name`), but Postgres evaluates the WITH CHECK against the entire resulting row.

All 6 current users have `is_admin = true`, so none of them can update their own profile through this policy. Super admins happen to work because they match the separate "Super admins can update all profiles" policy.

### Fix: Database Migration

Replace the "Users can update own profile" policy with one that:
- Allows users to update their own row (`id = auth.uid()`)
- Prevents them from changing protected fields (`is_admin`, `role`, `is_active`, `feature_flags`) — compare new values to current values
- Does NOT hardcode `is_admin = false`

```sql
DROP POLICY "Users can update own profile" ON public.user_profiles;

CREATE POLICY "Users can update own profile" ON public.user_profiles
FOR UPDATE TO authenticated
USING (id = auth.uid())
WITH CHECK (
  id = auth.uid()
  AND is_admin = (SELECT up.is_admin FROM public.user_profiles up WHERE up.id = auth.uid())
  AND is_active = (SELECT up.is_active FROM public.user_profiles up WHERE up.id = auth.uid())
  AND feature_flags = (SELECT up.feature_flags FROM public.user_profiles up WHERE up.id = auth.uid())
  AND role = (SELECT up.role FROM public.user_profiles up WHERE up.id = auth.uid())
);
```

This ensures protected fields can't change, but `first_name`, `last_name`, and `updated_at` can be freely edited.

### Files changed

| File | Change |
|------|--------|
| Migration SQL | Replace UPDATE policy on `user_profiles` |

No frontend changes needed — the save call already sends only editable fields.

