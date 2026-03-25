

# Revised Plan: Capture Full Item Data for Dedup Restore

This is an amendment to the approved plan, confirming the `removedDetails` structure must be expanded.

## Current State

The `removedDetails` interface only stores 5 fields:
```typescript
{ removed_name: string; removed_page: number; kept_name: string; kept_page: number; match_reason: string }
```

Missing for restore: `level`, `levelType`, `parent_name`, `description`, `owner`, `start_date`, `due_date`, `metrics`, and any other fields the AI extracted.

## Required Change

In `supabase/functions/process-plan/index.ts`, update the `DedupResult` interface and the `deduplicateItems` function:

1. **Interface**: Add `removed_item: Record<string, unknown>` to capture the full discarded object, and `removed_parent: string`, `kept_parent: string` for display:

```typescript
interface DedupResult {
  items: unknown[];
  removedDetails: {
    removed_name: string;
    removed_page: number;
    removed_parent: string;
    removed_item: Record<string, unknown>;  // full item for restore
    kept_name: string;
    kept_page: number;
    kept_parent: string;
    match_reason: string;
  }[];
}
```

2. **In the dedup loop** (line 352-358): Capture the full discarded item via spread, plus parent names:

```typescript
removedDetails.push({
  removed_name: discarded.name || "",
  removed_page: discarded.source_page || 0,
  removed_parent: discarded.parent_name || "",
  removed_item: { ...(itemsArr[discardIdx] as Record<string, unknown>) },
  kept_name: keeper.name || "",
  kept_page: keeper.source_page || 0,
  kept_parent: keeper.parent_name || "",
  match_reason: matchReason,
});
```

3. **In `finalResult`**: Include `dedupResults: dedupResult.removedDetails` so the frontend receives the full removed items via `step_results`.

This ensures the frontend `DedupSummaryCard` can reconstruct a complete `PlanItem` (with correct `levelName`, `levelDepth`, `parentId`, `description`, etc.) when the user clicks Restore.

All other aspects of the approved plan remain unchanged.

