# Fix: parent dedupe whitespace normalization

## Problem
On Tulane (AchieveIt All In, Pattern C), parents 3.1.3, 6.3.2, and 8.3.1.2 split into 2-3 duplicates because some rows have trailing whitespace (or internal double spaces) on the hierarchy cell value while others don't. The dedupe path key currently uses `normalize()` which trims + lowercases but does not collapse internal whitespace runs.

## Fix
In `src/utils/parsers/parseHierarchicalColumns.ts`:

1. Add a dedicated `normalizeWhitespace(s: string): string` helper:
   ```ts
   function normalizeWhitespace(s: string): string {
     return String(s || '').trim().replace(/\s+/g, ' ');
   }
   ```
   (No case change, no punctuation change — whitespace only.)

2. Change the parent dedupe path key construction (currently `filled.slice(0, d + 1).map(normalize).join(' > ')`) to layer whitespace collapse on top of the existing case/trim normalize:
   ```ts
   const pathKey = filled
     .slice(0, d + 1)
     .map(v => normalizeWhitespace(v).toLowerCase())
     .join(' > ');
   ```
   This preserves the existing case-insensitive behavior AND collapses internal whitespace runs, so `"3.1.3"`, `"3.1.3 "`, and `"3.1.3  "` all map to the same dedupe bucket.

3. **Do not** change what gets stored on the item. The `name` field continues to be assigned from the raw `value` (already trimmed via `cellAt`), so the first variant encountered in source order is what displays — exactly as requested.

## Out of scope (per user)
- No new lowercase changes beyond what dedupe already does
- No punctuation stripping
- No fuzzy matching
- No leaf-level dedupe changes (leaves remain unique per row)

## Files changed
- `src/utils/parsers/parseHierarchicalColumns.ts` — add `normalizeWhitespace` helper, update one line in the parent dedupe path key.

## Validation
Re-upload Tulane (AchieveIt All In). Confirm 3.1.3, 6.3.2, and 8.3.1.2 each appear once as a single parent with all expected children consolidated underneath. Confirm overall leaf count stays ~191 (no leaves dropped — only parent buckets collapsed). Spot-check that no other parents collapsed unexpectedly.
