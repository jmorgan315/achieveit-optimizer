

## Admin Settings Page for Token Pricing

Move hardcoded `MODEL_RATES` to a database table and add an admin Settings page for managing them.

### Database Migration

Create `admin_settings` table with RLS policies and seed current rates:
- `key TEXT PRIMARY KEY`, `value JSONB`, `updated_at`, `updated_by`
- Admin full access policy, authenticated read-only policy
- Seed with current `model_rates` values

### New Files

**`src/hooks/useModelRates.ts`** — Shared hook that fetches rates from `admin_settings` where `key = 'model_rates'`, caches in module-level variable so it only queries once per app session. Returns `Record<string, { input: number; output: number }>`.

**`src/pages/admin/SettingsPage.tsx`** — Admin settings page with:
- "Token Pricing (per million tokens)" section
- Editable input/output rate fields per model
- "Add Model" button for new entries
- "Save" button that upserts `admin_settings` row
- "Last updated by [name] at [time]" display

### Modified Files

| File | Change |
|------|--------|
| `src/pages/admin/AdminLayout.tsx` | Add "Settings" nav item with `Settings` icon |
| `src/App.tsx` | Add `/admin/settings` route |
| `src/pages/admin/SessionDetailPage.tsx` | Remove hardcoded `MODEL_RATES`, import from `useModelRates` hook, pass rates to `calcCost` |

### Technical Notes
- `MODEL_RATES` only exists in `SessionDetailPage.tsx` (confirmed via search) — single consumption point
- Module-level cache in `useModelRates` avoids repeated queries across page navigations
- `updated_by` references `auth.users(id)` for tracking who changed settings — resolved to display name via `user_profiles` join on the Settings page

