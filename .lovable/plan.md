

# Plan: Enhanced Tabular/Column-Based Hierarchy Recognition

## Problem Summary
The Vision AI is successfully extracting content from the Strategic Vision PDF, but it's not correctly understanding the **left-to-right column structure** that defines the hierarchy. In this document format:

| Column 1 | Column 2 | Column 3 | Column 4 | Column 5 |
|----------|----------|----------|----------|----------|
| Pillar (Level 1) | Objective (Level 2) | Outcome KPI (Level 3) | Strategy (Level 4) | Strategy KPI (Level 5) |

The AI needs to:
1. Detect that this is a column-based table with left-to-right hierarchy
2. Recommend the correct 5-level structure based on the column headers
3. Create items at the proper depth based on which column they appear in

## Solution Overview

```text
+---------------------------+     +---------------------------+
|   Vision AI Analyzes      |     |   Detect Column Headers   |
|   PDF Page Images         | --> |   (Pillar, Objective,     |
|                           |     |   Outcome KPI, etc.)      |
+---------------------------+     +---------------------------+
                                              |
                                              v
                           +----------------------------------+
                           |  Return documentTerminology     |
                           |  with columnHierarchy array:    |
                           |  ["Pillar", "Objective",        |
                           |   "Outcome KPI", "Strategy",    |
                           |   "Strategy KPI"]               |
                           +----------------------------------+
                                              |
                                              v
                           +----------------------------------+
                           |  Frontend builds detectedLevels |
                           |  from columnHierarchy order     |
                           +----------------------------------+
                                              |
                                              v
                           +----------------------------------+
                           |  Items assigned levelDepth      |
                           |  based on source column         |
                           +----------------------------------+
```

## Implementation Tasks

### Task 1: Update Vision AI Prompt for Column Detection
**File**: `supabase/functions/extract-plan-vision/index.ts`

Enhance the prompt to:
1. Explicitly detect when a document uses a tabular layout with column headers
2. Identify the left-to-right column order as the hierarchy order
3. Return a `columnHierarchy` array in the response indicating the detected column order

Key prompt additions:
```text
=== LEFT-TO-RIGHT COLUMN HIERARCHY (CRITICAL) ===

When you see a table with headers across the top:
1. The LEFT-MOST column = HIGHEST level (depth 1)
2. Each column to the RIGHT = one level DEEPER
3. The RIGHT-MOST column = LOWEST level (deepest)

Example table headers: "Pillar | Objective | Outcome KPI | Strategy | Strategy KPI"
This means:
- Pillar = depth 1 (strategic_priority)
- Objective = depth 2 (focus_area)  
- Outcome KPI = depth 3 (goal)
- Strategy = depth 4 (action_item)
- Strategy KPI = depth 5 (sub_action)

IMPORTANT: Return the column headers in the documentTerminology.columnHierarchy array in LEFT-TO-RIGHT order.
```

### Task 2: Update Response Schema for Column Hierarchy
**File**: `supabase/functions/extract-plan-vision/index.ts`

Add `columnHierarchy` to the `documentTerminology` schema:
```javascript
documentTerminology: {
  properties: {
    columnHierarchy: { 
      type: "array", 
      items: { type: "string" },
      description: "Column headers in left-to-right order representing hierarchy depth"
    },
    level1Term: { type: "string" },
    level2Term: { type: "string" },
    level3Term: { type: "string" },
    level4Term: { type: "string" },
    level5Term: { type: "string" }  // Add 5th level support
  }
}
```

### Task 3: Add 5th Level Type Support
**File**: `supabase/functions/extract-plan-vision/index.ts`

Expand the `levelType` enum to include a 5th level:
- Current: `["strategic_priority", "focus_area", "goal", "action_item"]`
- New: `["strategic_priority", "focus_area", "goal", "action_item", "sub_action"]`

Also update the prompt mapping to handle 5 levels:
```text
Common document terms -> Standard mapping:
- "Pillar", "Strategic Priority" -> strategic_priority (depth 1)
- "Objective", "Focus Area" -> focus_area (depth 2)
- "Outcome KPI", "Goal" -> goal (depth 3)
- "Strategy", "Initiative" -> action_item (depth 4)
- "Strategy KPI", "Metric" -> sub_action (depth 5)
```

### Task 4: Update Frontend to Handle Column Hierarchy
**File**: `src/components/steps/FileUploadStep.tsx`

When processing Vision AI results:
1. Check for `documentTerminology.columnHierarchy` in the response
2. If present, build `detectedLevels` from the column order (preserving actual column names)
3. Pass these levels to the Level Verification Modal

```typescript
// Build levels from column hierarchy
if (result.data.documentTerminology?.columnHierarchy?.length > 0) {
  detectedLevelsFromVision = result.data.documentTerminology.columnHierarchy.map(
    (name, idx) => ({
      depth: idx + 1,
      name: name // Use actual column name like "Outcome KPI"
    })
  );
}
```

### Task 5: Update Type Definitions
**File**: `src/utils/textParser.ts`

Add support for the 5th level in the level type mapping:
```typescript
const LEVEL_TYPE_TO_DEPTH: Record<string, number> = {
  'strategic_priority': 1,
  'focus_area': 2,
  'goal': 3,
  'action_item': 4,
  'sub_action': 5,  // New
};
```

### Task 6: Update Text-Based Extraction Prompt (Consistency)
**File**: `supabase/functions/extract-plan-items/index.ts`

Add the same 5-level support and column hierarchy detection to the text-based extraction for consistency when text extraction works.

## File Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `supabase/functions/extract-plan-vision/index.ts` | Modify | Enhanced prompt for column detection, 5-level schema |
| `supabase/functions/extract-plan-items/index.ts` | Modify | Add 5-level support for consistency |
| `src/components/steps/FileUploadStep.tsx` | Modify | Handle columnHierarchy in response |
| `src/utils/textParser.ts` | Modify | Add 5th level type mapping |

## Technical Details

### Column Hierarchy Detection Logic
The Vision AI will analyze the table structure by:
1. Looking for table headers in the first row
2. Counting the number of columns
3. Reading headers left-to-right to determine hierarchy depth
4. Returning both the raw headers AND the extracted items with correct levelType

### Row Processing
For each table row:
1. Read cells from left to right
2. Skip empty cells
3. Create items with:
   - `levelType` based on which column the content is in
   - `parentId` linking to the item from the column to its left
   - `children` array populated with items from columns to its right

### Example Transformation
Input row: `| Equity & Access | Improve Access | Increase by 10% | Expand Services | Track Monthly |`

Output structure:
```json
{
  "name": "Equity & Access",
  "levelType": "strategic_priority",
  "children": [{
    "name": "Improve Access", 
    "levelType": "focus_area",
    "children": [{
      "name": "Increase by 10%",
      "levelType": "goal",
      "metricTarget": "10%",
      "children": [{
        "name": "Expand Services",
        "levelType": "action_item",
        "children": [{
          "name": "Track Monthly",
          "levelType": "sub_action"
        }]
      }]
    }]
  }]
}
```

## Expected Outcome
After implementation:
1. Vision AI correctly identifies left-to-right column hierarchy from table headers
2. Level Verification Modal shows actual column names (Pillar, Objective, Outcome KPI, Strategy, Strategy KPI)
3. Items are assigned the correct levelDepth based on their source column
4. Parent-child relationships are built correctly across columns
5. Support for up to 5 hierarchy levels

