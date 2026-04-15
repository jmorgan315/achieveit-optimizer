

## Fix Case-Sensitive Domain Check

The `@achieveit.com` domain check uses `.endsWith()` without normalizing case, rejecting valid emails like `jkrause@achieveIt.com`.

### Changes

All instances of `.endsWith('@achieveit.com')` need `.toLowerCase().endsWith('@achieveit.com')`:

| File | Lines | Count |
|------|-------|-------|
| `src/hooks/useAuth.ts` | 16, 94, 104, 118 | 4 |
| `src/components/LoginPage.tsx` | 27 | 1 |
| `src/pages/admin/UsersPage.tsx` | 79 | 1 |
| `supabase/functions/invite-user/index.ts` | 43 | 1 |

**7 total replacements** — simple find-and-replace of `email.endsWith('@achieveit.com')` → `email.toLowerCase().endsWith('@achieveit.com')`.

No logic changes, no new files.

