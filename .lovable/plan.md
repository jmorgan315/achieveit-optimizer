

## Admin "All Imports" Toggle on RecentSessionsPage

### Changes

**`src/pages/Index.tsx`** — Pass `isAdmin` prop to `RecentSessionsPage`:
```tsx
<RecentSessionsPage onNewImport={handleNewImport} onSelectSession={handleSelectSession} userId={user.id} isAdmin={isAdmin} />
```

**`src/components/RecentSessionsPage.tsx`** — All changes in this file:

1. **Props**: Add `isAdmin?: boolean` to `RecentSessionsPageProps`
2. **SessionRow**: Add `user_id?: string | null` to the interface (needed for "All Imports" display)
3. **State**: Add `showAll` toggle state, default `false`
4. **User profiles map**: When `isAdmin && showAll`, fetch `user_profiles` to map user_id → display name/email for subtitles
5. **Query**: Modify `fetchSessions` — when `showAll` is true, omit the `.eq('user_id', userId)` filter and also select `user_id`. RLS already grants admins SELECT on all sessions.
6. **Toggle UI**: Between the "Recent Imports" heading and the session list, render a segmented toggle ("My Imports" / "All Imports") only when `isAdmin` is true
7. **Session card**: When `showAll`, show the user's name/email as a small subtitle line under the document name

No backend/migration changes needed — admin RLS already covers this.

### Files

| File | Change |
|------|--------|
| `src/components/RecentSessionsPage.tsx` | Add toggle, conditional query, user display |
| `src/pages/Index.tsx` | Pass `isAdmin` prop |

