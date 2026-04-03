

# Delete & Cancel Buttons on Session Cards + Cleanup SQL

## What We're Building

1. **Delete button** on every session card — with a confirmation dialog before deleting the session and its related `api_call_logs`.
2. **Cancel button** on `in_progress` sessions — sets `status='failed'`, `current_step='cancelled'`, and clears `pipeline_run_id` to break any chained processing.
3. **One-time SQL** for cleaning up stale in-progress sessions.

## Technical Plan

### File: `src/components/RecentSessionsPage.tsx`

**Add delete and cancel handlers:**
- `handleDelete(sessionId)`: Deletes from `api_call_logs` where `session_id` matches, then deletes from `processing_sessions`. Removes session from local state on success. Shows toast on error.
- `handleCancel(sessionId)`: Updates `processing_sessions` set `status='failed'`, `current_step='cancelled'`, `pipeline_run_id=null`. Updates local state to reflect new status. Shows toast on error.

**Add confirmation dialogs:**
- Use existing `AlertDialog` components for both actions.
- Each session card gets a small action area (right side) with:
  - For `in_progress` sessions: a "Cancel" icon button (X or Square icon) wrapped in an `AlertDialog` confirming "Cancel this import? This will stop processing."
  - For all sessions: a "Delete" icon button (Trash2 icon) wrapped in an `AlertDialog` confirming "Delete this session? This cannot be undone."
- Button clicks call `e.stopPropagation()` to prevent the card's `onClick` from firing.

**State additions:**
- `deletingId: string | null` and `cancellingId: string | null` for loading spinners on the buttons during async operations.

### One-Time Cleanup SQL

```sql
UPDATE processing_sessions
SET status = 'failed', current_step = 'cancelled', pipeline_run_id = NULL
WHERE status = 'in_progress'
  AND created_at < NOW() - INTERVAL '24 hours';
```

This will be provided as a copyable snippet — not run as a migration since it's a one-time data operation.

## Files to Modify

| File | Change |
|------|--------|
| `src/components/RecentSessionsPage.tsx` | Add delete/cancel handlers, confirmation dialogs, action buttons on each card |

