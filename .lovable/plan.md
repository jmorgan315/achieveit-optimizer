

# Fix Name Casing Issues

## Problem
1. Agent 3 replaces title-case names with ALL CAPS versions from decorative title pages
2. Capitalization-only changes incorrectly penalize confidence scores

## Changes

### 1. Validate-hierarchy prompt — capitalization preference (`validate-hierarchy/index.ts`)

Add after the DUPLICATE MERGING section (after line 37):

```
=== CAPITALIZATION ===

When you encounter the same item name in different capitalizations (e.g., 'BUILD A UNIVERSAL PATH TO EARLY LEARNING' vs 'Build a Universal Path to Early Learning'), always prefer the Title Case or sentence case version. ALL CAPS text in documents is typically a design/formatting choice, not the canonical name. Never output item names in ALL CAPS unless every version in the source document is ALL CAPS.
```

### 2. Confidence scoring — skip capitalization-only changes (`process-plan/index.ts`)

Add a helper function:

```typescript
function isCapitalizationOnlyChange(a: string, b: string): boolean {
  return a.toLowerCase().trim() === b.toLowerCase().trim();
}
```

In `calculateConfidence`, update the name-matching logic (line 144):
- When `!agent1NameSet.has(name)` is true, the name was already lowercased — so this check is unaffected (it already ignores case).

The real fix is in the **corrections evaluation**: when a correction is of type "renamed" or contains "rephrased", check if the old/new names only differ by capitalization. If so, tag it as `[user-override]` (no penalty) and change the description to "Name capitalization normalized".

Also update the `rephrasedNames` check (line 147): before assigning confidence=60, verify it's not a capitalization-only rephrase by checking if the original name (from audit) matches the corrected name case-insensitively. Since `rephrasedNames` is already lowercased and `name` is already lowercased, a match there means the extracted name IS in the rephrased set — but we need to check if the correction was only capitalization. Add the original text to the set as a map (`rephrasedMap: Map<lowercase, originalText>`) and compare.

Simpler approach: In the corrections loop (lines 126-134), detect capitalization-only corrections and reclassify them:

```typescript
for (const c of itemCorrections) {
  const isOverride = isUserOverrideCorrection(c);
  // Check if this is a capitalization-only rename
  const isCapOnly = (c.type === 'renamed' || /rephras/i.test(c.description || '')) 
    && c.originalName && c.correctedName 
    && isCapitalizationOnlyChange(c.originalName, c.correctedName);
  
  if (isCapOnly) {
    correctionDescs.push(`[user-override] Name capitalization normalized`);
  } else {
    const prefix = isOverride ? "[user-override]" : "[agent-correction]";
    correctionDescs.push(`${prefix} ${agent}: ${desc}`);
  }
}
```

And exclude cap-only corrections from `agentCorrections` count so they don't trigger the 80% penalty.

### Files

| File | Change |
|------|--------|
| `supabase/functions/validate-hierarchy/index.ts` | Add CAPITALIZATION section to system prompt |
| `supabase/functions/process-plan/index.ts` | Add `isCapitalizationOnlyChange` helper; reclassify cap-only corrections as no-penalty; exclude from agent correction count |

