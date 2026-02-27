

# Improve Extraction Completeness

The core problem: the AI is silently dropping items. Two strategies to fix this — (A) make the initial extraction more thorough, and (B) add a verification pass that catches gaps.

## Changes

### 1. Reduce chunk size from 50k to 25k characters (`extract-plan-items/index.ts`)
Smaller chunks mean the AI has less to process per call and is far less likely to skip items. 50k chars is pushing Claude's attention limits for detailed extraction.

### 2. Add a completeness verification pass (`extract-plan-items/index.ts`)
After the initial extraction of each chunk, do a lightweight second AI call:
- Send the original chunk text + the list of extracted item names
- Ask Claude to identify any bullets, goals, strategies, or KPIs that were missed
- Merge any newly found items into the correct parent in the existing tree
- This acts as a "second pair of eyes" specifically focused on gaps

### 3. Add bullet/item pre-count heuristic (`extract-plan-items/index.ts`)
Before sending to AI, count recognizable list markers in the text (bullets, numbered items, dashes). After extraction, compare total extracted items to this count. If extracted < 60% of the counted markers, log a warning and trigger the verification pass.

### 4. Strengthen the system prompt (`extract-plan-items/index.ts`)
Add explicit completeness instructions:
- "COMPLETENESS IS CRITICAL — you must extract EVERY bullet point, numbered item, goal, and action. Do NOT summarize or skip items you consider minor."
- "Count the bullets in each section and ensure your output has at least that many children."

### 5. Improve text-preference logic (`FileUploadStep.tsx`)
Currently the verification gate uses weak thresholds (1 item per 3 pages). Tighten to:
- At least 1 top-level item per 2 pages
- Total items (recursive) should be at least 2x page count
- Add a text-density check: if source text has >500 chars/page, strongly prefer text extraction over vision

### 6. Add per-chunk item count logging and user feedback (`FileUploadStep.tsx`)
Show the user running totals as chunks process: "Chunk 2/4: found 23 items (47 total so far)" so they can see progress and know if something seems off.

## Technical Flow

```text
Upload PDF
  → Parse text
  → Pre-count bullets/markers in text
  → For each 25k chunk:
      1. Initial extraction (Claude tool call)
      2. Compare extracted count vs bullet count
      3. If gap detected OR always: run verification pass
         → "Here's the text and what was found. What's missing?"
         → Merge missing items into tree
  → Final verification gate (tightened thresholds)
  → If failed → fallback to Vision AI
```

