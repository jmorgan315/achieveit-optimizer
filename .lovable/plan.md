

# Plan: Admin Section for API Call Logs

## New Files

### 1. `src/pages/admin/AdminLayout.tsx`
Sidebar layout wrapper using SidebarProvider. Sidebar has two links: "Sessions" and "API Logs". Header with SidebarTrigger and a "← Back to App" link. Renders `<Outlet />` for nested routes.

### 2. `src/pages/admin/SessionsPage.tsx`
- Fetches `processing_sessions` ordered by `created_at DESC`
- Summary cards at top: total sessions, total tokens, total API calls
- Filters: date range (two date inputs), status dropdown, extraction method dropdown
- Table with columns: Date, Org Name, Document Name, Method, Items Extracted, API Calls, Total Tokens, Duration, Status (as Badge)
- Rows link to `/admin/sessions/:id`

### 3. `src/pages/admin/SessionDetailPage.tsx`
- Fetches single `processing_sessions` row + all `api_call_logs` where `session_id` matches
- **Summary card**: org name, industry, document, method, items, calls, tokens (in/out), duration, status badge
- **Timeline**: chronological list of API calls, each as a Collapsible card showing step_label, edge_function, model, tokens, duration, status
- Expanded view uses Tabs with 3 tabs:
  - **Request**: Renders system prompt and user messages as formatted text blocks; truncated images show placeholder
  - **Response**: Renders main content/text as formatted text, plus structured data
  - **Raw JSON**: Full `request_payload` and `response_payload` in `<pre>` blocks with copy button

### 4. `src/pages/admin/ApiLogsPage.tsx`
- Fetches all `api_call_logs` ordered by `created_at DESC`
- Table: Date, Session ID (linked), Edge Function, Step Label, Model, Tokens In/Out, Duration, Status
- Filters: edge_function dropdown, status dropdown, model text filter

## Modified Files

### 5. `src/App.tsx`
Add admin routes:
```
<Route path="/admin" element={<AdminLayout />}>
  <Route index element={<Navigate to="sessions" />} />
  <Route path="sessions" element={<SessionsPage />} />
  <Route path="sessions/:id" element={<SessionDetailPage />} />
  <Route path="logs" element={<ApiLogsPage />} />
</Route>
```

### 6. `src/components/Header.tsx`
Add a small gear icon link to `/admin` in the right side nav area, using `react-router-dom`'s `Link`.

## Tech Choices
- All data fetching via `supabase` client with `.from()` queries
- shadcn/ui: Table, Card, Badge, Tabs, Collapsible, ScrollArea, Select, Input
- No authentication gating — but all admin pages are under `/admin` route group with a shared layout, making it easy to wrap with an auth guard later

