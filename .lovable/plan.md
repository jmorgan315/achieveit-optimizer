
# Plan: Fix AI Extraction Hierarchy and Level Mapping

## Problem Analysis

From the screenshots and code review, I've identified **three root causes**:

### Issue 1: AI Returns Flat Structure Despite Instructions
The AI is returning all items at the same level (`focus_area`) without using the `children` array for nesting. Even with explicit prompt instructions, the AI is ignoring the nesting requirement and returning:

```json
[
  { "name": "Economic Security", "levelType": "focus_area" },
  { "name": "Housing Access", "levelType": "focus_area" },
  { "name": "Increase BCHA units", "levelType": "focus_area" }
]
```

Instead of:
```json
[
  { 
    "name": "Economic Security", 
    "levelType": "strategic_priority",
    "children": [
      {
        "name": "Housing Access",
        "levelType": "focus_area",
        "children": [...]
      }
    ]
  }
]
```

### Issue 2: Level Depth Determined Only by AI's levelType
The current code in `textParser.ts` uses a static mapping:
```typescript
const LEVEL_TYPE_TO_DEPTH = {
  'strategic_priority': 1,
  'focus_area': 2,
  'goal': 3,
  'action_item': 4,
};
```

If AI returns all items as `focus_area`, they ALL get `levelDepth: 2` and ALL show as "Focus Area" in the UI.

### Issue 3: Order Strings Based on Parent Relationships
The order calculation uses `parentId` to determine nesting. With flat AI response (no children = no parent relationships), all items become root level: 1, 2, 3, 4, 5...

---

## Solution

### Part 1: Force AI to Use Proper Level Types

**File: `supabase/functions/extract-plan-items/index.ts`**

Strengthen the prompt to:
- Use **specific examples** from common strategic plan formats
- Add **validation rules** that the AI must follow
- Include a **self-check** instruction to verify nesting before returning

Key prompt additions:
```text
VALIDATION BEFORE RETURNING:
1. Count items at root level - should be 3-7 strategic priorities only
2. Verify each strategic_priority has children (focus_areas)
3. Verify bullet points under headings are nested as children, not siblings at root
4. If you have more than 8 items at root level, your nesting is wrong - restructure

OUTPUT VALIDATION:
- strategic_priority items: ONLY at root level, typically 3-7 total
- focus_area items: MUST be inside children[] of a strategic_priority
- goal items: MUST be inside children[] of a focus_area or strategic_priority
- action_item items: MUST be inside children[] of a goal or focus_area
```

### Part 2: Add Post-Processing Fallback for Flat Responses

**File: `src/utils/textParser.ts`**

Add intelligent fallback logic that:
1. **Detects flat responses** - if all items are at root level with same levelType
2. **Rebuilds hierarchy** from levelType ordering - strategic_priority becomes parent of subsequent focus_areas
3. **Recalculates order strings** based on rebuilt parent-child relationships

New function: `rebuildHierarchyFromFlatItems()`
```text
Algorithm:
1. Sort items by original order
2. Track "current parent" at each level
3. When encountering strategic_priority -> set as Level 1 parent
4. When encountering focus_area -> make child of current strategic_priority
5. When encountering goal -> make child of current focus_area
6. Rebuild order strings as 1, 1.1, 1.1.1, etc.
```

### Part 3: Fix Level Name Assignment

**File: `src/utils/textParser.ts`**

Change level assignment to use **actual tree depth** (based on parentId chain) rather than AI's levelType:

```text
Current (broken):
  depth = LEVEL_TYPE_TO_DEPTH[aiItem.levelType]  // All focus_area = depth 2
  levelName = levels.find(l => l.depth === depth)  // All show "Focus Area"

Fixed:
  treeDepth = countParentChain(parentId)  // 0 parents = depth 1, 1 parent = depth 2
  levelName = levels.find(l => l.depth === treeDepth)  // Uses actual position in tree
```

### Part 4: Ensure Level Recalculation on User Confirmation

**File: `src/hooks/usePlanState.ts`**

The `updateLevelsAndRecalculate` function needs to:
1. Update all items' `levelName` based on their `parentId` chain
2. Recalculate order strings for the entire tree
3. Preserve the hierarchy structure

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/extract-plan-items/index.ts` | Add stricter validation rules to prompt, add self-check instructions |
| `src/utils/textParser.ts` | Add `rebuildHierarchyFromFlatItems()`, fix level depth calculation to use tree depth |
| `src/hooks/usePlanState.ts` | Improve `recalculateOrders()` to properly assign levelName from tree depth |

---

## Expected Outcome

After implementation:

1. **AI returns properly nested structure** with strategic_priority > focus_area > goal > action_item
2. **Fallback handles flat responses** by inferring hierarchy from levelType ordering
3. **Level names match tree position** - root items = Level 1, their children = Level 2, etc.
4. **Order strings reflect hierarchy** - 1, 1.1, 1.1.1 instead of 1, 2, 3, 4

Example result for Boulder County document:
```text
1     Strategic Priority  Economic Security and Social Stability
1.1   Focus Area          Housing Access and Affordability
1.1.1 Goal                Increase BCHA affordable units by 3% in 2025
1.1.2 Goal                Net 600+ housing units within planning period
1.1.3 Goal                Support inclusionary housing initiatives
1.1.4 Goal                Complete Willoughby Corner project phases
1.2   Focus Area          Employment and Income Security
...
```

---

## Technical Implementation Details

### Hierarchy Rebuild Algorithm

```text
function rebuildHierarchyFromFlatItems(items):
  parentStack = {1: null, 2: null, 3: null, 4: null}
  
  for each item in items:
    levelDepth = LEVEL_TYPE_TO_DEPTH[item.levelType]
    
    # Find parent at level above
    parentDepth = levelDepth - 1
    item.parentId = parentStack[parentDepth]
    
    # Set this item as parent for deeper levels
    parentStack[levelDepth] = item.id
    
    # Clear deeper levels (they need new parents)
    for d in range(levelDepth + 1, 5):
      parentStack[d] = null
  
  return recalculateOrders(items)
```

### Tree Depth Calculation

```text
function getTreeDepth(itemId, items):
  depth = 1
  item = items.find(i => i.id === itemId)
  
  while item.parentId:
    depth++
    item = items.find(i => i.id === item.parentId)
  
  return depth
```
