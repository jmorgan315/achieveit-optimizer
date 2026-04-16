

## Upgrade Claude Sonnet 4 → Sonnet 4.6

The docs confirm: **`claude-sonnet-4-6`** is the correct API ID. Pricing: $3/$15 per MTok (unchanged from Sonnet 4.5).

### Changes

**Edge functions** — replace `claude-sonnet-4-20250514` → `claude-sonnet-4-6` in all occurrences:

| File | Occurrences |
|------|-------------|
| `supabase/functions/audit-completeness/index.ts` | model string in request body + logging |
| `supabase/functions/validate-hierarchy/index.ts` | model string in request body + logging |
| `supabase/functions/suggest-metrics/index.ts` | model string in request body + logging |

**Settings display** — `src/pages/admin/SettingsPage.tsx`:
- Update `MODEL_DISPLAY_NAMES` key from `claude-sonnet-4-20250514` to `claude-sonnet-4-6`
- Display name: "Claude Sonnet 4.6"

**Database migration** — update `admin_settings` pricing row:
```sql
UPDATE public.admin_settings
SET value = jsonb_set(
  value - 'claude-sonnet-4-20250514',
  '{claude-sonnet-4-6}',
  COALESCE(value->'claude-sonnet-4-20250514', '{"input":3,"output":15}')
)
WHERE key = 'model_rates'
  AND value ? 'claude-sonnet-4-20250514';
```

No changes to Opus (already `claude-opus-4-6`). All edge functions auto-deploy.

