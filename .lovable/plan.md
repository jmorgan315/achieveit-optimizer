

# Fix: Cross-Sheet Dedup, Department Tagging, Tree Rendering

## Problem Summary
1. Strategy/Outcome items duplicated per sheet (4 outcomes × 20 sheets = 80)
2. Sheet name should map to Member field as fallback
3. Tree renders all 700+ items expanded on mount — appears blank/frozen

## Changes

### 1. `src/utils/spreadsheet-parser.ts` — Smart cross-sheet dedup

**Replace the current `generatePlanItems` strategy pattern loop (lines 495-635)** with a two-pass approach:

- **Pass 1**: Before iterating sections, build lookup maps for Strategy and Outcome dedup:
  - `strategyMap: Map<normalizedName, PlanItem>` — reuse existing Strategy item if name matches (case-insensitive, trimmed)
  - `outcomeMap: Map<normalizedName + strategyId, PlanItem>` — reuse existing Outcome if same name under same Strategy
- When processing a section: find-or-create Strategy, find-or-create Outcome. Always create new Actions and Measurements.

**Replace the blanket dedup at lines 718-727**: Remove it entirely. The find-or-create logic handles Level 1/2 dedup during generation. Level 3+ items are always unique.

**Department/Member tagging (lines 580-590)**: After collecting member values from mapped columns, if `members` array is empty, fall back to using the source sheet name as the member value. Keep the `Source: [SheetName]` tag separately for traceability.

### 2. `src/components/steps/PlanOptimizerStep.tsx` — Lazy tree rendering

**Line 101**: Change initial `expandedItems` state. Instead of expanding all items, only expand if item count is small:
```typescript
const [expandedItems, setExpandedItems] = useState<Set<string>>(() => {
  if (items.length <= 80) return new Set(items.map(i => i.id));
  // Large imports: only expand root items
  return new Set<string>();
});
```

This means for 700+ item imports, only the ~4 Strategy root items render initially. Children mount only when expanded (already handled by `buildFlatList` checking `expandedItems.has(item.id)` at line 403).

No other tree component changes needed — `buildFlatList` already skips children of collapsed items. The `SortableTreeItem` already only renders what's in `flatList`. dnd-kit's `SortableContext` already only tracks visible items.

### Files

| File | Change |
|------|--------|
| `src/utils/spreadsheet-parser.ts` | Find-or-create dedup for L1/L2; remove blanket dedup; sheet name as Member fallback |
| `src/components/steps/PlanOptimizerStep.tsx` | Default collapsed state for large imports (line 101) |

### What does NOT change
- No PDF pipeline, edge functions, detection, mapping UI, DetectionSummary, FileUploadStep, Index.tsx, export logic, or admin panel changes

