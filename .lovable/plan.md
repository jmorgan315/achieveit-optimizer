

# Hardening UploadIdentifyStep Error Boundaries

## Changes — single file: `src/components/steps/UploadIdentifyStep.tsx`

### 1. Add mounted ref guard
- Add `useEffect` that sets a `mountedRef` to true on mount, false on cleanup
- Wrap all `setScanStatuses`, `setIsScanning`, `setPageCountError` calls to check `mountedRef.current` first
- Create a small helper: `const safeSetState = <T>(setter: (v: T) => void, v: T) => { if (mountedRef.current) setter(v) }`

### 2. Wrap `handleContinue` in top-level try/catch/finally
```typescript
const handleContinue = async () => {
  if (!uploadedFile || !orgName.trim() || !industry) return;
  setIsScanning(true);
  setPageCountError(null);
  try {
    // ... existing logic (ensureSessionId, upsert, spreadsheet/text/PDF paths)
  } catch (err: any) {
    console.error('[UploadIdentify] Unexpected error:', err);
    toast({ title: 'Something went wrong', description: 'Please try again.', variant: 'destructive' });
  } finally {
    if (mountedRef.current) setIsScanning(false);
  }
};
```
- Remove all individual `setIsScanning(false)` calls scattered before each `return` — the `finally` handles it.

### 3. Await the session upsert inside the try block
Change the fire-and-forget `.then()` pattern to:
```typescript
const { error: upsertError } = await supabase.from('processing_sessions').upsert({...}, { onConflict: 'id' });
if (upsertError) console.error('[UploadIdentify] Session update error:', upsertError);
```

### 4. Defensive `response.json()` parsing
Create a helper used by both parse-pdf and classify-document response handling:
```typescript
async function safeParseJson(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
}
```
Replace all `await response.json()` calls (4 occurrences in the PDF path) with `await safeParseJson(response)`.

### What stays the same
- `Promise.allSettled` pattern and overall flow unchanged
- Props interface unchanged
- Scanning overlay UI unchanged
- Spreadsheet and text file paths get the outer try/catch/finally but no structural changes

