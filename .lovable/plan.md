

# Add Presentation Extraction Mode

## Overview
Add a `"presentation"` branch in `extract-plan-vision` (same pattern as the existing `"table"` branch) and update `process-plan` to pass the required classification fields.

## 1. `supabase/functions/extract-plan-vision/index.ts`

**Parse new optional params** on line 610: add `pageAnnotations` and `nonPlanContent` to destructuring.

**Add `buildPresentationExtractionPrompt` helper** (near the existing `buildTableExtractionPrompt`):
- Accepts `pageAnnotations`, `hierarchyPattern`, `nonPlanContent`
- Returns the full presentation system prompt with `{PAGE_ANNOTATIONS}`, `{HIERARCHY}`, and conditional action-item metadata section injected

**Add presentation branch** between the table block (ends line 790) and standard block (line 792):
```
if (extractionMode === "presentation") { ... }
```
- Same structure as the table branch: build prompt, call Anthropic without tools, parse JSON array, run through `convertFlatToNested`, `normalizeResponse`, return

**System prompt**: Verbatim from user spec, with three template slots:
- `{PAGE_ANNOTATIONS}` → `JSON.stringify(pageAnnotations, null, 2)`
- `{HIERARCHY}` → `JSON.stringify(hierarchyPattern, null, 2)`
- Conditional action-item metadata section when `nonPlanContent?.has_action_items_with_metadata`

## 2. `supabase/functions/process-plan/index.ts`

**Update the extract-plan-vision call** (line ~422-436) to pass presentation-mode params:
```typescript
extractionMode,
tableStructure: extractionMode === "table" ? classification?.table_structure : undefined,
hierarchyPattern: (extractionMode === "table" || extractionMode === "presentation") ? classification?.hierarchy_pattern : undefined,
pageAnnotations: extractionMode === "presentation" ? classification?.page_annotations : undefined,
nonPlanContent: extractionMode === "presentation" ? classification?.non_plan_content : undefined,
```

## Files to modify

| File | Change |
|------|--------|
| `supabase/functions/extract-plan-vision/index.ts` | Add presentation prompt builder, presentation extraction branch |
| `supabase/functions/process-plan/index.ts` | Pass pageAnnotations + nonPlanContent for presentation mode |

