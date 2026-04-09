

## Add User Assignment to Admin Session Detail

### What Changes

**File: `src/pages/admin/SessionDetailPage.tsx`**

Add a "User" row to the session header card (after the existing grid of metadata fields) that shows:
- The currently assigned user's email + name, or "Unassigned" if `user_id` is null
- A Select dropdown (using the existing `src/components/ui/select.tsx`) populated with all users from `user_profiles`
- Selecting a user updates `processing_sessions.user_id` via supabase and refreshes local state

### Implementation Details

1. **Add state**: `users` array (fetched from `user_profiles`), `assigningUser` loading flag
2. **Fetch users** in the same `useEffect` that loads session + logs — add a third parallel query: `supabase.from('user_profiles').select('id, email, first_name, last_name').eq('is_active', true)`
3. **Add UI** below the metadata grid inside the existing Card: a row with label "User:", the current user's display (email + name), and a `<Select>` component with an "Unassigned" option + all users
4. **On change handler**: call `supabase.from('processing_sessions').update({ user_id }).eq('id', session.id)`, update local session state, show toast

### UI Layout

Inside the session header `<CardContent>`, after the grid, add:
```
User: john@achieveit.com (John Doe) [Select dropdown ▾]
```

The Select shows: "Unassigned", then each user as "email (First Last)".

