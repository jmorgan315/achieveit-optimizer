

# Fix Duplicate Extraction & Enforce User-Defined Level Count

## Problem
Vision extraction treats section title pages and detail pages as separate items, creating false parent-child duplicates (e.g., "BUILD A UNIVERSAL PATH TO EARLY LEARNING" as Goal → "Build a Universal Path to Early Learning" as Key Priority). Agent 3 ignores user-defined level count, producing 3+ levels when user specified 2.

## Changes

### 1. Vision extraction prompt — duplicate prevention (`extract-plan-vision/index.ts`)

Add to `VISION_EXTRACTION_PROMPT` (after line 237, in the EXTRACTION RULES section):

```
DUPLICATE DETECTION: Strategic plan documents often repeat the same items in multiple places — 
table of contents, section title pages, overview summaries, and detail pages. Extract each unique 
plan item ONLY ONCE. If you see the same goal/priority in multiple places (even with different 
wording/capitalization), extract it once using the most complete/detailed version.

Watch for:
- Table of contents entries that match section headers
- Section title pages (large text, just the goal name) matching the goal on the following detail page
- 'At a Glance' or summary pages listing items found in detail sections later

Prefer the detail page version over abbreviated TOC/title page versions.
```

### 2. Audit-completeness — duplicate detection (`audit-completeness/index.ts`)

Add duplicate detection instructions to both `TEXT_AUDIT_SYSTEM_PROMPT` and `VISION_AUDIT_SYSTEM_PROMPT`.

Add `duplicateItems` to `auditToolSchema`:
```json
{
  "duplicateItems": [{
    "item1Name": "string",
    "item1Level": "string", 
    "item2Name": "string",
    "item2Level": "string",
    "recommendation": "string"
  }]
}
```

Update `AuditFindings` interface in `process-plan/index.ts` to include `duplicateItems`.

### 3. Validate-hierarchy — enforce user-defined level count (`validate-hierarchy/index.ts`)

Add to `VALIDATION_SYSTEM_PROMPT` (line 11-40), a dynamic section injected when `planLevels` is provided:

```
USER-DEFINED PLAN LEVELS: The user has defined exactly {N} hierarchy levels: {level names}. 
Your output MUST have exactly {N} levels — no more, no less.

If extracted items have MORE levels than specified, collapse the hierarchy:
- Look for duplicate items at adjacent levels (parent-child with same/similar names)
- Merge them: keep one copy, remove duplicate, reassign children
- Re-assign items beyond max depth to the deepest user-defined level

CRITICAL: Never create levels beyond what the user defined.
```

This is injected into the user message (around line 206) as a prominent section, not buried in the system prompt, so it's harder for the model to ignore.

Also pass `duplicateItems` from audit findings to Agent 3 so it can act on them.

### 4. Post-Agent-3 safety net in `process-plan/index.ts`

After line 466 (after `calculateConfidence`), add a programmatic depth enforcer:

```typescript
if (planLevels && planLevels.length > 0) {
  const maxDepth = planLevels.length;
  enforceMaxDepth(finalItems, maxDepth, planLevels);
}
```

`enforceMaxDepth` recursively walks the tree:
- If an item is at depth > maxDepth, flatten it up to maxDepth (reassign `levelType` to deepest allowed level name)
- Detect adjacent parent-child duplicates (fuzzy name match using normalized lowercase comparison) and merge them — keep the parent, move grandchildren up

### Files to modify

| File | Change |
|------|--------|
| `supabase/functions/extract-plan-vision/index.ts` | Add duplicate detection rules to system prompt |
| `supabase/functions/audit-completeness/index.ts` | Add duplicate detection to both prompts + schema |
| `supabase/functions/validate-hierarchy/index.ts` | Inject level enforcement instructions when planLevels provided |
| `supabase/functions/process-plan/index.ts` | Add `duplicateItems` to interface, pass to Agent 3, add post-Agent-3 depth enforcer + duplicate merger |

