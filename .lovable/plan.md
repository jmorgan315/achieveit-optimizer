

# Changes: Org Profile Before Upload, Education Industry, Document Hints, Compact Row Icons

## 1. Add "Education" to industry list & open-text document hints (`OrgProfileStep.tsx`)
- Add `'Education'` to `INDUSTRIES` array between "Federal Government" and "Healthcare"
- Add a new `Textarea` field: "Any helpful information you'd like to provide about this document?" with helper text like: *"e.g., 'The plan starts on page 8', 'We have 5 levels: Pillar, Strategy, Objective, Initiative, KPI'"*
- Store this as `documentHints` on the `OrgProfile` type

## 2. Move Org Profile step BEFORE file upload (`Index.tsx`)
- Reorder wizard steps: `Organization → Upload Plan → Choose Path → Map People → Review & Export`
- Step 0 = OrgProfileStep, Step 1 = FileUploadStep
- Pass `orgProfile` (including `documentHints`) to `FileUploadStep` so it can forward hints to AI extraction calls

## 3. Pass document hints to AI extraction (`FileUploadStep.tsx`, edge functions)
- `FileUploadStep` receives `orgProfile` as a prop and includes `documentHints`, `organizationName`, and `industry` in the request body to `extract-plan-items` and `extract-plan-vision`
- Edge functions incorporate this context into AI prompts (not as a hard filter — page hints guide focus but don't exclude surrounding context)

## 4. Update `OrgProfile` type (`types/plan.ts`)
- Add `documentHints?: string` to `OrgProfile` interface

## 5. Compact row badges — icon-only with tooltips (`SortableTreeItem.tsx`)
- **Metric badge**: Remove "Metric" text, keep just the `Target` icon with tooltip showing metric summary
- **Date range**: Remove text, show just `Calendar` icon with tooltip showing the date range
- **Owner badge**: Remove name text from inline display, show just `User` icon with tooltip showing assignee name
- **Issue badges**: Remove text like "owner", "dates", "metric" — keep just icons with tooltips
- This significantly reduces horizontal clutter per row

## Files Modified
- `src/types/plan.ts` — add `documentHints` to `OrgProfile`
- `src/components/steps/OrgProfileStep.tsx` — add Education, add document hints textarea
- `src/pages/Index.tsx` — reorder steps, pass orgProfile to FileUploadStep
- `src/components/steps/FileUploadStep.tsx` — accept orgProfile prop, pass to AI calls
- `supabase/functions/extract-plan-items/index.ts` — include org context in prompt
- `supabase/functions/extract-plan-vision/index.ts` — include org context in prompt
- `src/components/plan-optimizer/SortableTreeItem.tsx` — icon-only badges with tooltips

