
# Plan: AI-Powered Intelligent Document Extraction

## Problem Analysis

The current `src/utils/textParser.ts` uses regex patterns to detect plan items based on:
- Numbering patterns (1.1.1)
- Label keywords ("Strategic Priority", "Objective")
- Indentation levels

This approach fails because real strategic plans contain significant narrative content that shouldn't be tracked. The Boulder County example has:
- 70% narrative/context (demographics, introductions, achievements)
- 30% actual trackable items (goals, initiatives, metrics)

## Solution: AI-Powered Extraction Edge Function

Replace the regex parser with an intelligent AI extraction step that can distinguish between narrative and actionable plan items.

### Architecture

```text
User uploads PDF
       |
       v
parse-pdf edge function (existing)
       |
       v
Raw text extracted
       |
       v
extract-plan-items edge function (NEW)
       |
       v
AI analyzes text, identifies:
  - Strategic priorities (top level)
  - Goals/Objectives (mid level)  
  - Initiatives/Actions (low level)
       |
       v
Structured JSON with hierarchy
       |
       v
Display in Plan Optimizer
```

### New Edge Function: extract-plan-items

**File: `supabase/functions/extract-plan-items/index.ts`**

This function will:
1. Accept the raw text from a document
2. Use Lovable AI (Gemini 3 Flash) to analyze and extract only trackable items
3. Return structured JSON with:
   - Hierarchical plan items
   - Detected owners/departments
   - Any dates or metrics found
   - Confidence scores for uncertain extractions

### AI Prompt Engineering

The prompt will instruct the model to:

1. **Identify trackable items** - Goals with measurable outcomes, not background narrative
2. **Detect hierarchy** - Which items are parent priorities vs child initiatives
3. **Extract metadata** - Owners, dates, metrics embedded in text
4. **Skip noise** - Table of contents, page numbers, image captions, introductory paragraphs

Example extraction from the Boulder County document:

```json
{
  "items": [
    {
      "name": "Economic Security and Social Stability",
      "levelType": "strategic_priority",
      "description": "Ensuring residents have resources for health and wellbeing",
      "children": [
        {
          "name": "Housing access and affordability",
          "levelType": "focus_area",
          "children": [
            {
              "name": "Increase BCHA affordable units by 3% in 2025",
              "levelType": "goal",
              "metricTarget": "3%",
              "metricUnit": "Percentage",
              "dueDate": "2025-12-31"
            },
            {
              "name": "Net 600+ housing units within planning period",
              "levelType": "goal",
              "metricTarget": "600",
              "metricUnit": "Number"
            }
          ]
        }
      ]
    }
  ]
}
```

### Changes Required

| File | Action | Purpose |
|------|--------|---------|
| `supabase/functions/extract-plan-items/index.ts` | Create | AI extraction endpoint using Lovable AI |
| `supabase/config.toml` | Modify | Add new function configuration |
| `src/components/steps/FileUploadStep.tsx` | Modify | Chain PDF parsing with AI extraction |
| `src/utils/textParser.ts` | Modify | Add function to convert AI response to PlanItem format |
| `src/hooks/usePlanState.ts` | Modify | Handle async AI extraction flow |

### User Experience Flow

1. User uploads PDF
2. Show "Extracting text from document..." (existing)
3. Show "AI analyzing document for plan items..." (new)
4. Display extracted items with confidence indicators
5. User can review and adjust before proceeding

### Edge Cases Handled

- Documents with no clear hierarchy - AI will infer based on context
- Multiple unrelated plans in one document - AI will group logically
- Heavily narrative documents - AI will extract only actionable items
- Mixed languages - Gemini supports multilingual extraction

### Technical Implementation Details

**AI Request Structure:**
```typescript
const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${LOVABLE_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "google/gemini-3-flash-preview",
    messages: [
      { role: "system", content: EXTRACTION_PROMPT },
      { role: "user", content: documentText }
    ],
    tools: [{
      type: "function",
      function: {
        name: "extract_plan_items",
        parameters: { /* structured output schema */ }
      }
    }],
    tool_choice: { type: "function", function: { name: "extract_plan_items" } }
  }),
});
```

**Extraction Prompt (key points):**
- You are analyzing a strategic planning document
- Extract ONLY items that would be tracked over time (goals, initiatives, KPIs)
- Skip: table of contents, demographics, historical achievements, mission statements
- Preserve hierarchy: Strategic Priority > Focus Area > Goal/Initiative > Action Item
- Extract any embedded metrics, dates, or owners

### Cost and Performance

- Single AI call per document (not per item)
- Gemini 3 Flash is fast and cost-effective
- Typical strategic plan (20-30 pages): 2-5 seconds processing
- Token usage: ~2000 input + ~1000 output per document

## Summary

This plan replaces the naive regex parser with intelligent AI extraction that understands document context and extracts only meaningful, trackable plan items while preserving hierarchy.
