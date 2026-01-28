
# Plan: Universal Document Structure Extraction with Vision AI

## Overview
The current extraction fails on documents with tabular layouts, graphics, or non-standard text positioning because the PDF text extraction only captures raw text (which is fragmented for complex layouts). The solution is to use a multimodal AI model that can "see" and understand document pages as images, enabling extraction from any document format.

## Root Cause Analysis
1. **Text extraction limitation**: The `unpdf` library extracts only embedded text strings, not content from images or complex visual layouts
2. **Your document's structure**: The Strategic Vision PDF uses a table format where content is in a 5-column matrix (Pillar, Objective, Outcome KPIs, Strategies, Strategy KPIs)
3. **Extracted text was corrupted**: Pages 2-9 show mostly "20 20 20..." fragments - the actual content is rendered as graphics/images, not selectable text
4. **Custom terminology**: The document defines its own hierarchy (Pillar > Objective > Strategy > KPI > Tollgate) which the AI needs to recognize

## Solution Architecture

```text
                      +------------------+
                      |   User Uploads   |
                      |       PDF        |
                      +--------+---------+
                               |
               +---------------+---------------+
               |                               |
      +--------v--------+             +--------v--------+
      |   parse-pdf     |             |   NEW: Vision   |
      | (text extract)  |             |   AI Analysis   |
      +--------+--------+             +--------+--------+
               |                               |
               |                               |
      +--------v--------+                      |
      | Has meaningful  |                      |
      | text content?   |                      |
      +--------+--------+                      |
               |                               |
          +----+----+                          |
          |         |                          |
         Yes       No                          |
          |         |                          |
          |    +----v----+                     |
          |    | Fallback+---------------------+
          |    +---------+
          |
      +---v---------------+
      | extract-plan-items|
      | (enhanced prompt) |
      +-------------------+
```

## Implementation Tasks

### Task 1: Create New Vision-Based Extraction Edge Function
**File**: `supabase/functions/extract-plan-vision/index.ts`

Create a new edge function that:
- Accepts base64-encoded page images from the frontend
- Uses Gemini 2.5 Pro (multimodal) to analyze page images
- Extracts structured plan items from visual content
- Handles tabular data, infographics, and custom document layouts

Key prompt elements:
- Detect document-specific terminology from definition pages
- Extract items from tables, columns, and matrices
- Identify hierarchy from visual position, indentation, or explicit labels
- Handle multiple pages with continuity tracking

### Task 2: Update Frontend to Capture Page Images
**File**: `src/components/steps/FileUploadStep.tsx`

Modify the file upload logic to:
1. First try text extraction with `parse-pdf`
2. Detect if extracted text is meaningful (not fragmented/corrupted)
3. If text is poor quality, use a PDF-to-image library or request page screenshots
4. Send page images to the new vision extraction endpoint

Add a quality detection function:
```typescript
function isTextQualityPoor(text: string): boolean {
  // Check for repetitive patterns like "20 20 20"
  // Check for low unique word ratio
  // Check for missing expected content
}
```

### Task 3: Enhance AI Extraction Prompt for Document Flexibility
**File**: `supabase/functions/extract-plan-items/index.ts`

Update the system prompt to:
- Explicitly detect document-defined terminology (Pillar, Objective, etc.)
- Map custom terms to the standard hierarchy levels
- Handle both hierarchical AND tabular structures in text
- Be more aggressive about extracting items even from partial text

Add to prompt:
```text
DOCUMENT TERMINOLOGY DETECTION:
Look for definition sections like "Terms definitions:", "Key terms:", etc.
Map the document's terms to standard hierarchy:
- If document defines "Pillar" = map to strategic_priority
- If document defines "Objective" = map to focus_area
- If document defines "Strategy/Tactic" = map to goal
- If document defines "KPI/Metric/Measure" = map to action_item
```

### Task 4: Add PDF Page Image Extraction
**File**: `supabase/functions/parse-pdf/index.ts`

Enhance the parse-pdf function to:
- Optionally render PDF pages as images using pdf.js or similar
- Return both extracted text AND base64 page images
- Let the frontend decide which extraction method to use based on text quality

### Task 5: Update Type Definitions
**File**: `src/utils/textParser.ts`

Add new types and handlers for:
- Vision extraction response format
- Document terminology mapping
- Tabular data conversion to hierarchy

## Technical Considerations

### AI Model Selection
- **Text extraction**: `google/gemini-3-flash-preview` (fast, cost-effective)
- **Vision extraction**: `google/gemini-2.5-pro` (best multimodal, handles complex layouts)

### Token Limits and Pagination
- For multi-page documents, process 2-3 pages at a time
- Maintain context about previous pages (e.g., "continuing from Pillar: Equity & Access")
- Merge results across page batches

### Error Handling
- Graceful fallback from vision to text extraction
- Clear user feedback when document cannot be parsed
- Suggest document format improvements if extraction fails

## File Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `supabase/functions/extract-plan-vision/index.ts` | Create | New vision-based extraction endpoint |
| `supabase/functions/extract-plan-items/index.ts` | Modify | Enhanced prompt for document flexibility |
| `supabase/functions/parse-pdf/index.ts` | Modify | Add page image rendering capability |
| `src/components/steps/FileUploadStep.tsx` | Modify | Add text quality detection, vision fallback |
| `src/utils/textParser.ts` | Modify | Add vision response handler |
| `src/types/plan.ts` | Modify | Add types for vision extraction |

## Expected Outcome
After implementation, the application will:
1. Successfully extract plan items from the "Strategic Vision" PDF (and similar documents)
2. Detect document-specific terminology (Pillar, Objective, Strategy, KPI)
3. Convert tabular/matrix layouts into proper hierarchical structures
4. Fall back gracefully between extraction methods
5. Handle any document format regardless of visual complexity
