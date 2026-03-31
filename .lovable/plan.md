
Goal: stop the persistent duplicate `processing_sessions` rows (one completed + one `in_progress` with null fields).

Do I know what the issue is? Yes.

Root cause (from code + data):
- The orphan row is created by `lookup-organization` when `OrgProfileStep` calls it with `sessionId` undefined.
- In that edge function, `ensureSession(undefined)` generates a new UUID and inserts an `in_progress` session.
- Later, the main import flow creates/uses a different session ID in `Index.tsx`, producing the second row.
- The current `useRef` fix only dedupes calls inside one `Index` instance; it does not unify the org-lookup session with the import session.

Implementation plan

1) `src/pages/Index.tsx` — harden session creation and remove render-time side effects
- Add `sessionPromiseRef` and convert `ensureSessionId` to async promise-guarded logic:
  - return `sessionIdRef.current` if set
  - return `sessionPromiseRef.current` if creation is in-flight
  - otherwise create one ID, set ref immediately, set state, insert/upsert row once
- Reset both refs in Start Over (`sessionIdRef.current = null`, `sessionPromiseRef.current = null`).
- Remove side-effect call from JSX: replace `sessionId={state.sessionId || ensureSessionId()}` with a pure value (`state.sessionId ?? sessionIdRef.current`).
- In `handleOrgProfileComplete` / `handleOrgProfileSkip`, `await ensureSessionId()` before advancing so step 1 always has a stable ID.

2) `src/components/steps/OrgProfileStep.tsx` — force lookup to use the same session
- Add prop `ensureSessionId: () => Promise<string>` (from parent).
- In `handleLookup`, resolve `const sid = sessionId ?? await ensureSessionId()` before invoking `lookup-organization`.
- Send that `sid` in request body.
- If response returns `data.sessionId`, surface it back to parent (optional callback) to keep parent ref/state synced as a safety net.

3) Wire props from `Index` to `OrgProfileStep`
- Pass `ensureSessionId` into `OrgProfileStep`.
- Add optional `onSessionIdResolved` handler in `Index` to sync `sessionIdRef` + state if backend returns an ID.

4) Verify behavior
- Run one spreadsheet import and one PDF import:
  - expected: exactly one new session row per import
  - no extra `in_progress` row with null org/document/method
  - org lookup log entries and import updates attach to the same session ID.

Files to update
- `src/pages/Index.tsx`
- `src/components/steps/OrgProfileStep.tsx`
