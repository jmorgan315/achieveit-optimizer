## Bug A Fix v2 — Always dedupe leaves (option a)

### Root cause recap

Row 1 of each Tulane block has `rawValues[leafDepthIdx]` populated, so `leafIsInherited = false`. The dedup gate at line 605 (`if (!isLeaf || leafIsInherited)`) skips both the lookup AND the registration. Row 2 of the same block (Strategy inherited) then misses on `parentByKey.get` because row 1 never registered, creates a second leaf, and only rows 3–13 collapse into row 2's entry. Net: 2 leaves per block instead of 1.

### Fix

In `src/utils/parsers/parseHierarchicalColumns.ts`, the row loop (~lines 581–668), drop the `leafIsInherited` distinction. All leaves participate in `parentByKey` dedup at their `dedupeKey`. First row at a given `(leafDepth, path)` wins and owns the attributes (owner, dueDate, description, tags, metric, members) — same "first row wins" semantic we already accepted for collapsed inherited leaves.

Concrete edits:

1. Remove the `leafIsInherited` local (no longer needed).
2. Replace the gate at line 605:
   ```ts
   // Dedup ALL nodes (parents and leaves) by (depth + path).
   const existing = parentByKey.get(dedupeKey);
   if (existing) {
     parentId = existing.id;
     if (isLeaf) break;   // collapse into existing leaf, done with row
     continue;
   }
   ```
3. Replace the register block at line 664:
   ```ts
   items.push(item);
   parentByKey.set(dedupeKey, item);
   parentId = item.id;
   ```

That's the entire change. The `parentByKey` name becomes slightly misleading (now holds leaves too) but renaming is out of scope — leave a one-line comment instead.

### Why this is safe for the no-skip case

In the no-skip Tulane mapping, `leafDepthIdx = Tactic`. Each Tactic row has its own raw cell, so each `(3, "goal>obj>strat>tactic")` dedupeKey is naturally unique. The new gate hits the `existing` branch only when two rows really do share the same full path — which is exactly the 8.3.1.2-style triple-duplicate case, already on backlog and confirmed acceptable by user. Test 3 should hold at 170.

Santa Cruz (730) and Carmen (17) have no inherited-leaf scenarios under their normal mappings; no change expected.

### Out of scope

- Renaming `parentByKey` → `nodeByKey`.
- Per-row attribute merge for collapsed leaves (still "first row wins").
- Bug B narrowing — stays as-is per user decision.
- LevelMappingInterface for Pattern A "Adjust" — backlog, 4c-territory.

### Files changed

- `src/utils/parsers/parseHierarchicalColumns.ts` — simplify leaf dedup gate + registration.

### Validation after deploy

1. Tulane skip-Tactic → one Strategy per Goal/Obj block, count drops well below 140.
2. Tulane skip-Objective → similar collapse.
3. Tulane normal mapping → 170 items (8.3.1.2 stays at 2).
4. Santa Cruz → 730.
5. Carmen → 17.
6. Multi-sheet DRAFT (Pattern A + B/C) → per-sheet cards render with per-sheet Adjust.
