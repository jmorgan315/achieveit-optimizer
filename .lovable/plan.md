

# Fix Missing Request Payload in validate-hierarchy Logging

## Problem
In `validate-hierarchy/index.ts` line 305, the `request_payload` logged is just metadata:
```typescript
request_payload: { sourceTextLength: sourceText.length, extractedItemCount: extractedItems.length, hasAuditFindings: !!auditFindings }
```
This explains the empty Request tab in admin — it has no `messages` or `system` field for the renderer to display.

Meanwhile, `audit-completeness` correctly logs the full `requestBody` (with image truncation for vision mode) at line 398.

## Fix — `supabase/functions/validate-hierarchy/index.ts`

Replace the `request_payload` in both `logApiCall` calls (success at line 305 and error at line 280) with the actual `requestBody`, truncating the source text to keep payload size reasonable:

```typescript
// Build a log-safe version of the request (truncate source text in the user message)
const logPayload = {
  ...requestBody,
  messages: requestBody.messages.map(msg => ({
    ...msg,
    content: typeof msg.content === 'string' && msg.content.length > 10000
      ? msg.content.slice(0, 10000) + `\n[TRUNCATED: ${msg.content.length} chars total]`
      : msg.content,
  })),
};
```

Use `logPayload` as the `request_payload` in both logApiCall invocations.

For the error path (line 280), the `requestBody` variable is already constructed by that point (line 251-262), so it just needs to reference it.

### audit-completeness — already correct
Line 398 builds `logPayload` with image truncation and passes it. No changes needed.

## Files to modify

| File | Change |
|------|--------|
| `supabase/functions/validate-hierarchy/index.ts` | Log full `requestBody` (with truncated user message) instead of metadata-only object |

