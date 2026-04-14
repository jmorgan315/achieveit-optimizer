

## Investigation: Why Some Inline Edits Don't Persist

### Root Cause Found

There are **two distinct bugs**, both in the hydration path — not in saving.

---

### Bug 1: Dates and most fields are lost during hydration

**The save works correctly.** `planItemToRaw()` in `useAutoSave.ts` serializes dates as `start_date` and `due_date` (snake_case), which matches the AI extraction format. The data IS being written to Supabase properly.

**The problem is in hydration.** When a session is resumed (`handleSelectSession` in `Index.tsx`, line 244-270), the saved items are fed back through `convertAIResponseToPlanItems()`. This function expects the `AIExtractedItem` interface:

```typescript
interface AIExtractedItem {
  name: string;
  levelType: string;
  owner?: string;        // ← hydration reads this
  startDate?: string;    // ← hydration reads this  
  dueDate?: string;      // ← hydration reads this
  children?: AIExtractedItem[];
}
```

But `planItemToRaw()` saves with different field names:

```typescript
{
  name: item.name,
  level_name: item.levelName,   // saved as level_name
  levelType: item.levelName,    // also saved
  owner: item.assignedTo,       // ✅ matches — that's why Assigned To persists!
  start_date: item.startDate,   // ❌ saved as start_date, but hydration reads startDate
  due_date: item.dueDate,       // ❌ saved as due_date, but hydration reads dueDate
  status: item.status,          // ❌ not in AIExtractedItem at all — lost
  description: item.description,// ❌ not in AIExtractedItem — gets default ''
  metric_description: ...,      // ❌ snake_case vs camelCase mismatch
  // etc.
}
```

**Why `name` and `assignedTo` survive:** `name` is the same field name in both formats. `assignedTo` is saved as `owner`, which matches `AIExtractedItem.owner`. Everything else is either snake_case vs camelCase mismatch or simply not present in `AIExtractedItem`.

**Additionally**, `convertAIResponseToPlanItems` hard-codes defaults that overwrite saved values:
- `status` is always set to `'Not Started'` (line 683)
- `updateFrequency` is always `'Monthly'` (line 689)
- `metricRollup` is always `'Manual'` (line 692)

### Bug 2: Level name changes aren't saved

When the user changes level names via "Configure Levels", `updateLevelsAndRecalculate()` updates both `state.levels` and recalculates `levelName` on each item. The auto-save hook saves the items (which now have updated `levelName` values), but it does **NOT** save the `levels` array itself.

During hydration, levels are read from `step_results.data.detectedLevels` (line 249). But auto-save only writes to `step_results.data.items` — it never updates `detectedLevels`. So the old level names are restored on reload, and `updateLevelsAndRecalculate(levels)` on line 270 overwrites the item-level names back to the originals.

---

### Fix Plan

**Fix 1: Save items in PlanItem format, not AIExtractedItem format. Hydrate directly.**

The auto-save should save items in the exact `PlanItem` shape (camelCase, all fields). On hydration, if the saved data is already in `PlanItem` format, skip `convertAIResponseToPlanItems()` and hydrate directly. Add a version/format marker to distinguish.

Changes:
- **`useAutoSave.ts`**: Replace `planItemToRaw()` with a serializer that preserves all PlanItem fields in camelCase. Add a `format: 'planItem'` marker to the saved payload.
- **`Index.tsx` (hydration in `handleSelectSession`)**: Check for the format marker. If `format === 'planItem'`, reconstruct items directly without going through `convertAIResponseToPlanItems()`. Otherwise fall back to the old path for backward compatibility.

**Fix 2: Save level definitions in auto-save.**

Changes:
- **`useAutoSave.ts`**: Accept `levels: PlanLevel[]` as an additional parameter. Write `detectedLevels` into `step_results.data.detectedLevels` alongside `items`.
- **`PlanOptimizerStep.tsx` or `Index.tsx`**: Pass `levels` to the `useAutoSave` hook.

### Files to modify

| File | Change |
|------|--------|
| `src/hooks/useAutoSave.ts` | Accept `levels` param; save items in PlanItem format with format marker; save levels as `detectedLevels` |
| `src/pages/Index.tsx` | In `handleSelectSession`: detect format marker, hydrate PlanItems directly when present; pass `levels` to `useAutoSave` |

### Backward compatibility

Old sessions saved in the AI format will still hydrate through `convertAIResponseToPlanItems()` as before. Only new saves will use the direct format.

