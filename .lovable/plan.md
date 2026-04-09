

## Four Dedup Fixes

### 1. Fix ghost dupe filter (too aggressive)

**File: `src/components/steps/PlanOptimizerStep.tsx` (~line 453)**

Change filter from:
```typescript
d.removed_name !== d.kept_name
```
to:
```typescript
!(d.removed_name === d.kept_name && d.removed_parent === d.kept_parent)
```

### 2. Fix restore parent matching

**File: `src/pages/Index.tsx` (~lines 455-484)**

Replace the fuzzy `includes` matching with a tiered approach:
1. Exact match (normalized)
2. `startsWith` match (normalized)
3. First-N-words match (compare first 4 words)
4. Fallback to `kept_parent` with same tiers
5. Root as last resort

Add enhanced debug logging that prints `removed_parent`, `kept_parent`, and all available item names so mismatches are diagnosable.

### 3. Pass dedup context to Agent 2

**File: `supabase/functions/process-plan/index.ts` (~lines 1317-1334)**

Add `dedupRemovedNames` to the audit payload — a list of `removed_name` values from `dedupResult.removedDetails`.

**File: `supabase/functions/audit-completeness/index.ts`**

In both `TEXT_AUDIT_SYSTEM_PROMPT` and `VISION_AUDIT_SYSTEM_PROMPT`, append a dynamic section when dedup names are provided:
```
The following items were identified as duplicates and intentionally removed. Do NOT flag them as missing: [list]
```

Read `dedupRemovedNames` from the request body and inject it into the prompt sent to Claude.

### 4. Keep restore debugging logs

No changes needed — the existing `console.log` calls in `handleRestoreDedupItem` will be preserved. The enhanced logging from fix #2 adds more detail.

### Files to modify

| File | Change |
|------|--------|
| `src/components/steps/PlanOptimizerStep.tsx` | Fix ghost dupe filter condition |
| `src/pages/Index.tsx` | Tiered parent matching + enhanced debug logs |
| `supabase/functions/process-plan/index.ts` | Pass dedup removed names to audit payload |
| `supabase/functions/audit-completeness/index.ts` | Inject dedup exclusion list into audit prompt |

