/**
 * Phase 4d.2.b — translate AI exclude_row_predicates into 3 supported regex
 * patterns and apply them against PlanItem trees.
 *
 * No filename/sheet-name heuristics. Every parsed predicate carries explicit
 * column-header text + literal value, both extracted from the raw natural-
 * language predicate the classifier produced.
 */

import { PlanItem } from '@/types/plan';
import { stemKey } from '@/utils/parsers/parseHierarchicalColumns';

export type ParsedPredicate =
  | { kind: 'column-equals'; columnHeader: string; value: string }
  | { kind: 'column-contains'; columnHeader: string; text: string }
  | { kind: 'starts-with'; text: string }
  | { kind: 'too-complex' };

function findHeader(name: string, headers: string[]): string | null {
  const target = stemKey(name);
  const hit = headers.find(h => stemKey(h) === target);
  return hit ?? null;
}

/**
 * Recognized natural-language patterns (case-insensitive):
 *  1. "rows where <header> = <value>"  / "rows where <header> is <value>"
 *  2. "rows where <header> contains <text>" / "...includes <text>"
 *  3. "rows starting with <text>" / "rows that start with <text>"
 */
export function parsePredicate(predicate: string, headers: string[]): ParsedPredicate {
  const raw = String(predicate || '').trim();
  if (!raw) return { kind: 'too-complex' };
  const text = raw.replace(/^skip\s+/i, '').replace(/^exclude\s+/i, '').trim();

  // starts-with
  let m = text.match(/^rows?\s+(?:that\s+)?start(?:ing|s)?\s+with\s+["“']?(.+?)["”']?\.?$/i);
  if (m) return { kind: 'starts-with', text: m[1].trim() };

  // column contains
  m = text.match(/^rows?\s+where\s+(?:the\s+)?["“']?(.+?)["”']?\s+(?:contains|includes)\s+["“']?(.+?)["”']?\.?$/i);
  if (m) {
    const header = findHeader(m[1].trim(), headers);
    if (header) return { kind: 'column-contains', columnHeader: header, text: m[2].trim() };
  }

  // column equals / is
  m = text.match(/^rows?\s+where\s+(?:the\s+)?["“']?(.+?)["”']?\s+(?:=|==|is|equals?)\s+["“']?(.+?)["”']?\.?$/i);
  if (m) {
    const header = findHeader(m[1].trim(), headers);
    if (header) return { kind: 'column-equals', columnHeader: header, value: m[2].trim() };
  }

  return { kind: 'too-complex' };
}

/**
 * Apply a parsed predicate to a flat PlanItem list. Matches against:
 *  - starts-with: item.name OR description starts with text
 *  - column-equals/contains: PlanItem fields are looked up by stem-folded
 *    header → known PlanItem field. Unknown headers degrade to name match.
 *
 * Removed parents cascade-remove their descendants.
 */
function fieldFor(item: PlanItem, headerStem: string): string {
  switch (headerStem) {
    case 'name':
    case 'item':
    case stemKey('item name'):
      return item.name || '';
    case stemKey('assigned to'):
    case 'owner':
    case stemKey('assignee'):
      return item.assignedTo || '';
    case 'status':
      return String(item.status || '');
    case stemKey('description'):
      return item.description || '';
    case stemKey('due date'):
    case 'date':
      return item.dueDate || '';
    case stemKey('start date'):
      return item.startDate || '';
    case 'tag':
    case 'tags':
      return (item.tags || []).join(' ');
    default:
      return '';
  }
}

export function applyPredicate(
  items: PlanItem[],
  parsed: ParsedPredicate,
  _headers: string[],
): PlanItem[] {
  if (parsed.kind === 'too-complex') return items.slice();

  const removeIds = new Set<string>();
  const lower = (s: string) => s.toLowerCase();

  for (const it of items) {
    let match = false;
    if (parsed.kind === 'starts-with') {
      const t = lower(parsed.text);
      match = lower(it.name || '').startsWith(t) || lower(it.description || '').startsWith(t);
    } else if (parsed.kind === 'column-equals') {
      const v = fieldFor(it, stemKey(parsed.columnHeader));
      match = lower(v).trim() === lower(parsed.value).trim();
    } else if (parsed.kind === 'column-contains') {
      const v = fieldFor(it, stemKey(parsed.columnHeader));
      match = lower(v).includes(lower(parsed.text));
    }
    if (match) removeIds.add(it.id);
  }

  // Cascade: anything whose ancestor is removed is also removed.
  const idToParent = new Map<string, string | null>();
  items.forEach(it => idToParent.set(it.id, it.parentId ?? null));
  for (const it of items) {
    let pid = idToParent.get(it.id) ?? null;
    while (pid) {
      if (removeIds.has(pid)) { removeIds.add(it.id); break; }
      pid = idToParent.get(pid) ?? null;
    }
  }

  return items.filter(it => !removeIds.has(it.id));
}
