# AchieveIt Plan Optimizer — Application Synopsis

Use this document as context when working with Claude on prompt engineering for this application.

---

## Purpose

AchieveIt Plan Optimizer is a web application that converts unstructured strategic planning documents (PDFs, pasted text) into structured, hierarchical plan data formatted for import into the **AchieveIt** strategic planning platform. The output is a CSV file matching AchieveIt's exact import template.

---

## Technology Stack

- **Frontend**: React + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Backend**: Supabase Edge Functions (Deno) via Lovable Cloud
- **AI Providers**: Anthropic Claude (extraction, metrics) + Lovable AI / Gemini (org lookup)
- **Drag-and-drop**: @dnd-kit for tree reordering in the plan editor

---

## Wizard Flow (4 steps)

1. **Organization Profile** (`OrgProfileStep`) — User enters org name + industry. An AI lookup edge function identifies the org, its website, and a summary. User can also provide "document hints" (free-text guidance about the document). Can be skipped.

2. **Upload Plan** (`FileUploadStep`) — User uploads a PDF or pastes text. The system:
   - Extracts text from PDF via `parse-pdf` edge function
   - Assesses text quality; if poor (scanned/image-based), falls back to **vision extraction** (renders PDF pages to images, sends to `extract-plan-vision`)
   - If text quality is good, sends to `extract-plan-items` for text-based extraction
   - After extraction, a **Level Verification Modal** shows the detected hierarchy levels for user confirmation/editing

3. **Map People** (`PeopleMapperStep`) — Displays all person/role names found during extraction. User maps each name to an email address for the AchieveIt "Assigned To" field.

4. **Review & Export** (`PlanOptimizerStep`) — Full tree editor with:
   - Drag-and-drop reordering and re-parenting
   - Inline editing of all plan item fields
   - Level management (rename, reorder hierarchy levels)
   - AI-powered metric suggestions per item (`suggest-metrics` edge function)
   - Item deletion (cascades to children)
   - Export to AchieveIt-formatted CSV

---

## Data Model

### PlanItem (core entity)
```typescript
interface PlanItem {
  id: string;
  order: string;           // Hierarchical numbering: "1", "1.1", "1.1.2"
  levelName: string;       // Display name: "Strategic Priority", "Objective", etc.
  levelDepth: number;      // 1-based depth in hierarchy
  name: string;
  description: string;
  status: 'On Track' | 'At Risk' | 'Off Track' | 'Complete' | 'Not Started' | '';
  startDate: string;       // YYYY-MM-DD
  dueDate: string;
  assignedTo: string;      // Email address
  members: string[];
  administrators: string[];
  updateFrequency: 'Weekly' | 'Monthly' | 'Quarterly' | 'Not Required' | '';
  metricDescription: 'Track to Target' | 'Maintain' | 'Stay Above' | 'Stay Below' | '';
  metricUnit: 'Number' | 'Dollar' | 'Percentage' | '';
  metricRollup: 'Manual' | 'Sum Children' | 'Average Children' | '';
  metricBaseline: string;
  metricTarget: string;
  currentValue: string;
  tags: string[];
  parentId: string | null;
  children: PlanItem[];
  issues: PlanItemIssue[];  // Validation warnings
}
```

### PlanLevel
```typescript
interface PlanLevel {
  id: string;
  name: string;   // e.g., "Strategic Priority", "Objective", "Goal"
  depth: number;   // 1 = top level
}
```

Default levels: Strategic Priority (1) → Objective (2) → Goal (3) → Strategy (4) → KPI (5)

### OrgProfile
```typescript
interface OrgProfile {
  organizationName: string;
  industry: string;
  website?: string;
  summary?: string;
  documentHints?: string;  // User hints about the document content
  confirmed: boolean;
}
```

---

## Edge Functions (AI-powered backend)

### 1. `extract-plan-items` — Text-based extraction
- **Input**: Raw text (up to 300K chars), optional org context
- **AI Model**: Anthropic Claude
- **Strategy**: 
  - Splits text into 25K-char chunks at paragraph boundaries
  - Multi-pass: extraction → completeness verification (if bullet count ratio < 60%)
  - Deduplication across chunks using item name matching
- **System Prompt Focus**: 
  - Dynamic level detection (not forcing a template)
  - Mandatory hierarchical nesting (flat output = wrong)
  - Completeness: every bullet must be extracted, never summarize
  - Schema discovery from document terminology
  - 7-level deep inlined JSON schema (no $ref)
- **Output**: Hierarchical items array + detectedLevels array

### 2. `extract-plan-vision` — Image-based extraction (for scanned PDFs)
- **Input**: Base64 page images (max 20, max 5MB each), optional org context
- **AI Model**: Anthropic Claude with vision
- **Strategy**:
  - Processes pages in batches of 3
  - Passes previous batch context to maintain continuity
  - Layout detection first (portrait/landscape, tabular/narrative/mixed)
  - Schema discovery from column headers and definition sections
  - Merged cell handling for matrix/table layouts
- **System Prompt Focus**:
  - Full-width table capture (don't stop at column 2)
  - Column-to-hierarchy mapping
  - Document terminology detection (not generic defaults)
- **Output**: Same structure as text extraction + layoutInfo + documentTerminology

### 3. `suggest-metrics` — SMART metric suggestions
- **Input**: Item name, optional description, optional orgProfile
- **AI Model**: Anthropic Claude
- **Output**: suggestedName, metricDescription, metricUnit, metricTarget, metricBaseline, rationale
- **Uses tool_use** to get structured output

### 4. `lookup-organization` — Org identification
- **Input**: organizationName, industry
- **AI Model**: Lovable AI (Gemini 2.5 Flash)
- **Output**: Official name, website URL, summary

### 5. `parse-pdf` — PDF text extraction
- Extracts raw text from uploaded PDF files

---

## Client-side Processing

### Text Parser (`src/utils/textParser.ts`)
- Fallback parser when AI extraction isn't available
- Pattern-based detection of: numbering (1.1.1), labeled items ("Objective 1.1:"), owners, dates (including quarter formats like Q1 2024), statuses, metrics
- Hierarchical nesting via indent level and numbering depth

### Export (`src/utils/exportToExcel.ts`)
- Generates CSV matching AchieveIt's 18-column import template
- Flattens hierarchical tree to ordered rows
- Columns: Order, Level, Name, Description, Status, Start Date, Due Date, Assigned To, Members, Administrators, Update Frequency, Metric Description, Metric Unit, Metric Rollup, Metric Baseline, Metric Target, Current Value, Tags

---

## Key Extraction Prompt Design Principles

1. **Completeness over precision** — "FAILURE TO EXTRACT ALL ITEMS IS THE WORST POSSIBLE ERROR"
2. **Dynamic level detection** — The AI must detect the document's own hierarchy terms, not force a template
3. **Mandatory nesting** — Flat output is explicitly marked as wrong; self-check instructions included
4. **Verification pass** — A second AI call acts as a "completeness auditor" comparing extracted items against the source
5. **Bullet counting heuristic** — Pre-counts bullet markers in source text; if extraction captures < 60%, triggers verification
6. **Summary/Overview deduplication** — Favors root items with actionable children over redundant overview themes
7. **Org context injection** — Organization name, industry, and document hints are prepended to user messages (first chunk only)
8. **Tabular/matrix awareness** — Special handling for merged cells, column hierarchies, and landscape orientation

---

## AchieveIt Import Format Reference

The target output CSV must match this exact column order:
Order | Level | Name | Description | Status | Start Date | Due Date | Assigned To | Members | Administrators | Update Frequency | Metric Description | Metric Unit | Metric Rollup | Metric Baseline | Metric Target | Current Value | Tags

- **Order**: Hierarchical numbering (1, 1.1, 1.1.1)
- **Level**: The level name (e.g., "Strategic Priority")
- **Status values**: On Track, At Risk, Off Track, Complete, Not Started
- **Update Frequency**: Weekly, Monthly, Quarterly, Not Required
- **Metric Description**: Track to Target, Maintain, Stay Above, Stay Below
- **Metric Unit**: Number, Dollar, Percentage
- **Metric Rollup**: Manual, Sum Children, Average Children
- **Date format**: M/D/YY
