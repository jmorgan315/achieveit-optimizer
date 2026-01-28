

# Plan: Fix AI Extraction Hierarchy, Level Verification, and Bullet Point Detection

## Problem Summary

Based on the screenshots and feedback, there are four distinct issues:

1. **Flat numbering**: Items are displayed as 1, 2, 3, 4, 5, 6... instead of proper hierarchy (1, 1.1, 1.1.1)
2. **Skipped level verification**: The AI extraction path bypasses the level configuration modal
3. **Missing bullet points**: Same-level bullet items (e.g., all the "For its part, the county will:" bullets) are not being extracted
4. **No level adjustment in optimizer**: Users cannot modify plan levels once in the Plan Optimizer step

---

## Root Cause Analysis

### Issue 1: Flat Numbering
The AI is returning items with a `children` array for nesting, but when items are at the same visual level in a document (like a list of goals), the AI places them as siblings at the root level. The `convertAIResponseToPlanItems()` function then assigns sequential numbers (1, 2, 3...) instead of respecting the user-defined level hierarchy.

**Current behavior**:
```text
AI returns: [item1, item2, item3, item4, item5]  // All at root
Result:     1, 2, 3, 4, 5, 6...                  // Flat numbers
```

**Expected behavior**:
```text
AI returns: [strategic_priority with children]
Result:     1, 1.1, 1.1.1, 1.2, 2, 2.1...       // Nested numbers
```

### Issue 2: Skipped Level Verification
In `Index.tsx`, the `handleAIExtraction` callback goes directly to step 1:
```typescript
const handleAIExtraction = (items, personMappings, levels) => {
  setLevels(levels);
  setItems(items, personMappings);
  setCurrentStep(1); // Skips level verification modal!
};
```

### Issue 3: Missing Bullet Points
The AI prompt doesn't explicitly instruct to capture all bullet points at the same indent level. Looking at the Boulder County document, bullets like:
- "Support inclusionary housing initiatives..."
- "Invest in mobile home parks..."
- "Study methods creating and retaining affordable housing..."

...should all be captured as goals or action items.

### Issue 4: No Level Adjustment in Optimizer
The `PlanOptimizerStep` component doesn't include any UI to modify the plan levels.

---

## Solution

### Part 1: Update AI Prompt for Better Extraction

**File: `supabase/functions/extract-plan-items/index.ts`**

Enhance the system prompt to:
- Explicitly capture ALL bullet points at the same indent level as the same type of item
- Ensure proper hierarchical nesting based on document structure
- Add guidance about treating indented content as children of the preceding item

Key prompt additions:
- "If a section has bullet points at the same indentation level, treat ALL bullets as the same level type (e.g., all as 'goal' or all as 'action_item')"
- "Nest items under their logical parent based on document structure - bullet points under a heading should be children of that heading"
- "Do not leave items as orphans at the root level unless they truly are top-level strategic priorities"

### Part 2: Show Level Verification After AI Extraction

**File: `src/pages/Index.tsx`**

Modify `handleAIExtraction` to:
1. Store AI-extracted data temporarily
2. Show the `LevelVerificationModal` with AI-detected levels pre-populated
3. After user confirms levels, recalculate order strings based on confirmed hierarchy

New state variables:
```typescript
const [pendingAIData, setPendingAIData] = useState<{
  items: PlanItem[];
  personMappings: PersonMapping[];
  detectedLevels: PlanLevel[];
} | null>(null);
```

Flow change:
```text
AI Extraction Complete
        |
        v
Store in pendingAIData
        |
        v
Show LevelVerificationModal (with detected levels)
        |
        v
User confirms/adjusts levels
        |
        v
Recalculate item hierarchy with confirmed levels
        |
        v
Proceed to next step
```

### Part 3: Fix Order Calculation Based on User-Defined Levels

**File: `src/utils/textParser.ts`**

Update `convertAIResponseToPlanItems()` to:
1. Accept the user-confirmed levels
2. Map AI level types to user level depths correctly
3. Ensure order strings reflect the hierarchy (1, 1.1, 1.1.1 pattern)

The current mapping:
```typescript
const LEVEL_TYPE_TO_DEPTH = {
  'strategic_priority': 1,
  'focus_area': 2,
  'goal': 3,
  'action_item': 4,
};
```

Should dynamically use the user's level configuration to assign depths, and recalculate all order strings after items are placed in hierarchy.

### Part 4: Add Level Configuration to Plan Optimizer

**File: `src/components/steps/PlanOptimizerStep.tsx`**

Add a "Configure Levels" button that opens the `LevelVerificationModal`, allowing users to:
- Rename levels
- Add/remove levels
- Reorder levels

When levels change, items need their `levelName` updated to match the new level configuration.

**New prop needed**: `onUpdateLevels: (levels: PlanLevel[]) => void`

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/extract-plan-items/index.ts` | Enhance AI prompt for bullet point capture and proper nesting |
| `src/pages/Index.tsx` | Add pending AI data state, show level modal for AI extraction path |
| `src/utils/textParser.ts` | Fix `convertAIResponseToPlanItems` to respect user levels and calculate proper order strings |
| `src/components/steps/PlanOptimizerStep.tsx` | Add "Configure Levels" button and integrate `LevelVerificationModal` |
| `src/hooks/usePlanState.ts` | Add `updateLevelsAndRecalculate()` function to update items when levels change |

---

## Technical Details

### AI Prompt Enhancement (Key Additions)

```text
CRITICAL HIERARCHY RULES:
1. Bullet points at the same indentation level MUST be the same item type
2. Content under a heading or title should be nested as children
3. Strategic Priorities are ONLY top-level themes - there should typically be 3-7
4. Goals and Action Items should ALWAYS be nested under Focus Areas or Priorities
5. Never return more than 5-8 items at the root level

BULLET POINT HANDLING:
- If you see a list of bullets following a section header, ALL bullets become children of that section
- Bullets prefixed with "•", "-", "*", or similar should all be captured
- Example: "The county will:" followed by 5 bullets = 5 goals under that focus area
```

### Order Recalculation Logic

```typescript
function recalculateOrderStrings(items: PlanItem[]): PlanItem[] {
  // Group items by parentId
  const byParent = new Map<string | null, PlanItem[]>();
  
  items.forEach(item => {
    const parentId = item.parentId;
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId)!.push(item);
  });
  
  // Recursively assign order strings
  function assignOrders(parentId: string | null, prefix: string): PlanItem[] {
    const children = byParent.get(parentId) || [];
    return children.flatMap((child, idx) => {
      const order = prefix ? `${prefix}.${idx + 1}` : String(idx + 1);
      const updated = { ...child, order };
      return [updated, ...assignOrders(child.id, order)];
    });
  }
  
  return assignOrders(null, '');
}
```

### Level Configuration in Optimizer UI

The "Configure Levels" button will be placed in the header area of the Plan Optimizer step, next to the "Plan Structure" title. When clicked, it opens the existing `LevelVerificationModal` component. On confirm, items are updated to use the new level names.

---

## Expected Outcome

After implementation:

1. **Hierarchy displays correctly**: Items show as 1, 1.1, 1.1.1, 1.2, 2, 2.1, etc.
2. **Level verification always shown**: Users can always confirm/adjust levels before proceeding
3. **All bullet points captured**: Same-level bullets like housing initiatives are extracted as goals/actions
4. **Levels adjustable in optimizer**: Users can modify level names and structure at any time

