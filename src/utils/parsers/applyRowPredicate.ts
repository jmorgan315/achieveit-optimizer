/**
 * Phase 4d.2.b — translate AI exclude_row_predicates into supported regex
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
  // Allow "tactic/description" → try each segment via stem-fold; first wins.
  const parts = name.includes('/')
    ? name.split('/').map(s => s.trim()).filter(Boolean)
    : [name];
  for (const part of parts) {
    const target = stemKey(part);
    const hit = headers.find(h => stemKey(h) === target);
    if (hit) return hit;
  }
  return null;
}

// Quote chars: straight + curly, single + double.
const Q = `["“”'‘’]`;

/**
 * Recognized natural-language patterns (case-insensitive):
 *  1. "rows where <header> = <value>" / "...is <value>" / "...equals <value>"
 *  2. "rows where <header> contains <text>" / "...includes <text>"
 *  3. "rows where <header> starts with <text>"
 *  4. "rows starting with <text>" (bare)
 */
export function parsePredicate(predicate: string, headers: string[]): ParsedPredicate {
  const raw = String(predicate || '').trim();
  if (!raw) return { kind: 'too-complex' };
  const text = raw.replace(/^skip\s+/i, '').replace(/^exclude\s+/i, '').trim();

  // column-scoped starts-with
  let m = text.match(new RegExp(
    `^rows?\\s+where\\s+(?:the\\s+)?${Q}?(.+?)${Q}?\\s+starts?\\s+with\\s+${Q}?(.+?)${Q}?\\.?$`, 'i'));
  if (m) {
    const header = findHeader(m[1].trim(), headers);
    if (header) return { kind: 'column-contains', columnHeader: header, text: m[2].trim() };
    // Fall through to bare starts-with if header didn't resolve.
  }

  // bare starts-with
  m = text.match(new RegExp(
    `^rows?\\s+(?:that\\s+)?start(?:ing|s)?\\s+with\\s+${Q}?(.+?)${Q}?\\.?$`, 'i'));
  if (m) return { kind: 'starts-with', text: m[1].trim() };

  // column contains
  m = text.match(new RegExp(
    `^rows?\\s+where\\s+(?:the\\s+)?${Q}?(.+?)${Q}?\\s+(?:contains|includes)\\s+${Q}?(.+?)${Q}?\\.?$`, 'i'));
  if (m) {
    const header = findHeader(m[1].trim(), headers);
    if (header) return { kind: 'column-contains', columnHeader: header, text: m[2].trim() };
  }

  // column equals / is
  m = text.match(new RegExp(
    `^rows?\\s+where\\s+(?:the\\s+)?${Q}?(.+?)${Q}?\\s+(?:=|==|is|equals?)\\s+${Q}?(.+?)${Q}?\\.?$`, 'i'));
  if (m) {
    const header = findHeader(m[1].trim(), headers);
    if (header) return { kind: 'column-equals', columnHeader: header, value: m[2].trim() };
  }

  return { kind: 'too-complex' };
}

/**
 * fieldFor — prefer source row data via PlanItem.rawRowData (4d.2.b).
 * Stem-folded header lookup so capitalization/whitespace differences match.
 * Legacy fallback only when rawRowData is missing (older sessions).
 *
 * NOTE: deliberately does NOT route source "Status" → item.status. The
 * lifecycle field has different semantics from a source-data Status column.
 */
function fieldFor(item: PlanItem, columnHeader: string): string {
  const raw = item.rawRowData;
  if (raw) {
    const target = stemKey(columnHeader);
    for (const k of Object.keys(raw)) {
      if (stemKey(k) === target) {
        const v = raw[k];
        if (v != null && v !== '') return v;
      }
    }
    // rawRowData present but no key match → return empty (no fallback).
    return '';
  }
  // Legacy fallback
  switch (stemKey(columnHeader)) {
    case 'name':
    case 'item':
    case stemKey('item name'):
      return item.name || '';
    case stemKey('assigned to'):
    case 'owner':
    case stemKey('assignee'):
      return item.assignedTo || '';
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
      const v = fieldFor(it, parsed.columnHeader);
      match = lower(v).trim() === lower(parsed.value).trim();
    } else if (parsed.kind === 'column-contains') {
      const v = fieldFor(it, parsed.columnHeader);
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
