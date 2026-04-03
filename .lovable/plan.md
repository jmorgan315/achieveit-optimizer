

# Revised Plan: Recent Sessions Landing Page

## Change from Previous Plan

Remove the cost column from the sessions list entirely. Cost is an internal/admin metric — users don't need it at a glance. This eliminates the N+1 query problem (no `api_call_logs` queries on the landing page).

## Changes

### 1. New file: `src/components/RecentSessionsPage.tsx`

- Single query: `processing_sessions` ordered by `created_at DESC`, limit 20, filter `document_name IS NOT NULL`
- No `api_call_logs` query at all
- Each row shows: org name, document name, status badge (green/yellow/red), items count, relative time
- "New Import" primary button in header
- Empty state with prompt
- Props: `onNewImport`, `onSelectSession`

### 2. Modify: `src/pages/Index.tsx`

- Add `activeView: 'sessions' | 'wizard'` state (default: `'sessions'`)
- `onNewImport`: reset state, set `activeView = 'wizard'`, step 0
- `onSelectSession`: hydrate session data, set `activeView = 'wizard'`, jump to appropriate step (step 4 for completed, step 2 for in_progress)
- `handleStartOver`: return to `activeView = 'sessions'`
- Hydration logic for completed sessions: extract items/levels/personMappings from `step_results.data`

### Files

| File | Change |
|------|--------|
| `src/components/RecentSessionsPage.tsx` | Create — sessions list, no cost column |
| `src/pages/Index.tsx` | Add activeView state, session selection, hydration, navigation |

### No Changes To
- Backend, edge functions, admin panel, wizard steps, database schema

