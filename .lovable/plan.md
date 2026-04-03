

# One-Time Cleanup: Mark Stale Sessions as Failed

## What
Run a database migration that updates all `processing_sessions` with `status = 'in_progress'` older than 24 hours — setting them to `status = 'failed'`, `current_step = 'cancelled'`, and `pipeline_run_id = NULL`.

## How
A single SQL migration:

```sql
UPDATE processing_sessions
SET status = 'failed',
    current_step = 'cancelled',
    pipeline_run_id = NULL
WHERE status = 'in_progress'
  AND created_at < NOW() - INTERVAL '24 hours';
```

This will clean up the ~40+ stale sessions currently stuck as "in_progress" in your database. It runs once as a migration and won't affect future sessions.

## Files
| File | Change |
|------|--------|
| `supabase/migrations/<timestamp>_cleanup_stale_sessions.sql` | One-time UPDATE migration |

