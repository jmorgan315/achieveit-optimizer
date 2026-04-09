

## Fix: Populate parent_name during flattening

### Problem
`flattenItems()` (line 551 in `process-plan/index.ts`) destructures `{ children, ...rest }` and pushes `rest` into the flat array, then recursively flattens `children`. But it never sets `parent_name` on child items. Since Agent 1's nested output uses `children[]` for hierarchy (not `parent_name`), every flattened child ends up with `parent_name: undefined`. This makes the parent-aware dedup comparison treat all items as root-level, defeating the same-parent check.

### Fix
One change to `flattenItems` — pass the parent's `name` down and assign it to each child:

**File: `supabase/functions/process-plan/index.ts` (lines 551-562)**

```typescript
function flattenItems(items: unknown[], parentName?: string): unknown[] {
  const flat: unknown[] = [];
  for (const item of items) {
    const i = item as Record<string, unknown>;
    const { children, ...rest } = i;
    // If this item doesn't already have a parent_name, use the one from the recursive call
    if (parentName && !rest.parent_name) {
      rest.parent_name = parentName;
    }
    flat.push(rest);
    const itemName = (rest.name as string) || undefined;
    if (Array.isArray(children) && children.length > 0) {
      flat.push(...flattenItems(children as unknown[], itemName));
    }
  }
  return flat;
}
```

The recursive calls at lines 558, 569, 570 pass no second argument and will default to `undefined`, so top-level items are unaffected. Only nested children get `parent_name` populated.

### Files to modify
| File | Change |
|------|--------|
| `supabase/functions/process-plan/index.ts` | Update `flattenItems` to propagate parent name to children |

Then redeploy `process-plan`.

