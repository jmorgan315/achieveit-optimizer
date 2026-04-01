

# Add `callAnthropicWithRetry` shared utility and apply to Agents 2 & 3

## Overview
Add an exponential-backoff retry wrapper for Anthropic API calls to `_shared/logging.ts`, then use it in `audit-completeness` and `validate-hierarchy` edge functions. Backend-only change — no frontend modifications.

## Changes

### 1. `supabase/functions/_shared/logging.ts` — add `callAnthropicWithRetry`

Add a new exported async function at the end of the file:

```typescript
export async function callAnthropicWithRetry(
  url: string,
  fetchOptions: RequestInit,
  maxRetries = 3,
  initialDelayMs = 2000,
): Promise<Response> {
  const RETRYABLE_STATUSES = new Set([429, 408, 529]);
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, fetchOptions);
      if (response.ok || !RETRYABLE_STATUSES.has(response.status) || attempt === maxRetries) {
        return response;
      }
      // Retryable status — log and retry
      const delay = initialDelayMs * Math.pow(2, attempt);
      console.warn(`[Retry] Attempt ${attempt + 1}/${maxRetries} failed with status ${response.status}. Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    } catch (err) {
      // Network error
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === maxRetries) throw lastError;
      const delay = initialDelayMs * Math.pow(2, attempt);
      console.warn(`[Retry] Attempt ${attempt + 1}/${maxRetries} network error: ${lastError.message}. Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError || new Error("Retry failed");
}
```

### 2. `supabase/functions/audit-completeness/index.ts`

- Import `callAnthropicWithRetry` from `../_shared/logging.ts`
- Replace the direct `fetch("https://api.anthropic.com/v1/messages", ...)` call (line 362) with `callAnthropicWithRetry("https://api.anthropic.com/v1/messages", { method, headers, body })`
- No other changes — same `startTime`, `durationMs`, error handling, response parsing

### 3. `supabase/functions/validate-hierarchy/index.ts`

- Import `callAnthropicWithRetry` from `../_shared/logging.ts`
- Replace the direct `fetch(...)` call (line 265) with `callAnthropicWithRetry(...)` 
- No other changes

### 4. Deploy & verify

Deploy all three: `_shared/logging.ts` is bundled automatically with each function, so deploy `audit-completeness` and `validate-hierarchy`. Verify via edge function logs.

## Files

| File | Change |
|------|--------|
| `supabase/functions/_shared/logging.ts` | Add `callAnthropicWithRetry` function |
| `supabase/functions/audit-completeness/index.ts` | Import + use retry wrapper for Anthropic fetch |
| `supabase/functions/validate-hierarchy/index.ts` | Import + use retry wrapper for Anthropic fetch |

