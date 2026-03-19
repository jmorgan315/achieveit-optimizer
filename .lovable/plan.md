

# Add Table-Aware Extraction Mode to extract-plan-vision

## Overview
When `extractionMode === "table"`, use a specialized system prompt that leverages Agent 0's `tableStructure` and `hierarchyPattern` to extract items from tabular documents. The standard tool_use approach is replaced with a direct JSON response since the table prompt specifies a flat array with `parent_name` references.

## 1. `supabase/functions/extract-plan-vision/index.ts`

**Parse new optional params** (line ~430):
- `extractionMode` (string, default "standard")
- `tableStructure` (object or null)
- `hierarchyPattern` (object or null)

**Add table extraction prompt** as a new constant `TABLE_EXTRACTION_PROMPT` containing the full system prompt from the user's spec, with `{TABLE_STRUCTURE}` and `{HIERARCHY_MAPPING}` placeholders.

**Branch logic based on extractionMode** (line ~528):
- When `extractionMode === "table"`:
  - Build system prompt by injecting `JSON.stringify(tableStructure, null, 2)` and `JSON.stringify(hierarchyPattern, null, 2)` into the template
  - Do NOT use `tools` or `tool_choice` — the prompt asks for raw JSON output
  - Set `max_tokens: 16384` (same as standard)
  - Parse the response text as JSON (strip markdown fencing if present)
  - Convert the flat array with `parent_name` references into a nested tree structure matching the standard output format (`items` with `children`)
  - Map `level`/`level_name` to `levelType` for compatibility
  - Preserve extra fields (`source_column`, `metadata`) — they pass through harmlessly

- When `extractionMode !== "table"`: existing behavior unchanged

**Add helper: `convertFlatToNested`**:
- Takes the flat array from table extraction (each item has `parent_name` or `null`)
- Groups items by level, links children to parents by matching `parent_name` to `name`
- Returns nested tree + `detectedLevels` derived from unique `level_name` values

**Normalize table output** to match standard format:
- Map `level_name` → `levelType` field
- Wrap in `{ items, detectedLevels, documentTerminology }` structure
- Run through existing `normalizeResponse` (extra fields like `metadata` and `source_column` pass through safely)

## 2. `supabase/functions/process-plan/index.ts`

**In the vision extraction loop** (line ~422), pass classification data when in table mode:
```typescript
const result = await callEdgeFunction("extract-plan-vision", {
  pageImages: batch,
  previousContext,
  organizationName,
  industry,
  documentHints,
  planLevels,
  pageRange,
  sessionId,
  batchLabel: `Step 2: Document Scan (Batch ${batchIdx + 1} of ${batches.length})`,
  // Table mode params
  extractionMode,
  tableStructure: extractionMode === "table" ? classification?.table_structure : undefined,
  hierarchyPattern: extractionMode === "table" ? classification?.hierarchy_pattern : undefined,
});
```

## Files to modify

| File | Change |
|------|--------|
| `supabase/functions/extract-plan-vision/index.ts` | Add table prompt, branching logic, flat-to-nested converter |
| `supabase/functions/process-plan/index.ts` | Pass extractionMode + classification data to extract-plan-vision |

