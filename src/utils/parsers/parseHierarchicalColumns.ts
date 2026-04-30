/**
 * Phase 4b.1 — Unified Pattern B/C parser.
 *
 * Consumes classifier `layout_classification.sheets[].structure` to convert a
 * single ParsedSheet into a flat list of PlanItems with parent linkage.
 *
 * Pattern B (`category_columns`): hierarchy lives in N category-style columns;
 *   blank cells inherit from the most recent non-blank value above. Rows may
 *   have partial chains — the deepest non-blank cell is the leaf for that row.
 *
 * Pattern C (`column_nested`): hierarchy columns are expected to carry the
 *   full ancestor chain on each leaf row; gaps fill from inheritance. The
 *   deepest configured level is always the leaf.
 *
 * IMPORTANT: zero filename / sheet-name / column-string heuristics. Every
 * structural decision flows from `structure.*`, runtime cell content, or
 * the optional `userLevels` array.
 */

import { PlanItem, PersonMapping } from '@/types/plan';
import { ParsedSheet, ColumnRole, getDefaultColumnRole, parseSpreadsheetDate } from '@/utils/spreadsheet-parser';

export type HierarchySignal =
  | 'section_headers'
  | 'category_columns'
  | 'column_nested'
  | 'pivot_rows'
  | string;

export interface SheetClassificationStructure {
  header_row_index: number | null;
  data_starts_at_row: number | null;
  name_column_index: number | null;
  hierarchy_signal?: HierarchySignal;
  implied_levels?: string[];
}

export interface SheetClassification {
  sheet_name: string;
  pattern: 'A' | 'B' | 'C' | 'D' | string;
  confidence?: number;
  reasoning?: string;
  structure?: SheetClassificationStructure;
}

export interface ParseHierarchicalResult {
  items: PlanItem[];
  personMappings: PersonMapping[];
  allColumnHeaders: string[];
  unresolvedLevels?: string[];
  resolvedLevels: string[];
  resolvedColumnIndices: number[];
}

const SHEET_DEFAULT_HEADER_ROW = 0;
const SHEET_DEFAULT_DATA_ROW = 1;

function normalize(s: string): string {
  return String(s || '').trim().toLowerCase();
}

/**
 * Whitespace-only normalization for parent-dedupe comparisons.
 * Trims leading/trailing whitespace AND collapses internal whitespace runs to
 * a single space. Does NOT change case or strip punctuation — purely cosmetic.
 */
function normalizeWhitespace(s: string): string {
  return String(s || '').trim().replace(/\s+/g, ' ');
}

function readHeaderRow(sheet: ParsedSheet, headerRowIndex: number): string[] {
  const row = sheet.rows[headerRowIndex];
  if (!Array.isArray(row)) return [];
  return row.map(c => (c == null ? '' : String(c).trim()));
}

function createEmptyPlanItem(overrides: Partial<PlanItem>): PlanItem {
  return {
    id: '',
    order: '',
    levelName: '',
    levelDepth: 1,
    name: '',
    description: '',
    status: '' as PlanItem['status'],
    startDate: '',
    dueDate: '',
    assignedTo: '',
    members: [],
    administrators: [],
    updateFrequency: '',
    metricDescription: '',
    metricUnit: '',
    metricRollup: '',
    metricBaseline: '',
    metricTarget: '',
    currentValue: '',
    tags: [],
    parentId: null,
    children: [],
    issues: [],
    confidence: 100,
    ...overrides,
  };
}

interface LevelResolution {
  resolvedLevels: string[];           // ordered names actually used
  resolvedColumnIndices: number[];    // parallel: column index per level
  unresolvedLevels: string[];         // levels with no header match AND no ordinal slot
}

/**
 * Resolve hierarchy column positions, in priority order:
 *   1. user-stated levels (case/trim-tolerant header match)
 *   2. classifier implied_levels (same matching)
 *   3. ordinal column position (level i → column i) as last-resort fallback
 */
function resolveHierarchyColumns(
  headerRow: string[],
  userLevels: string[] | undefined,
  classifierLevels: string[] | undefined,
  totalColumns: number,
): LevelResolution {
  const provided = (userLevels && userLevels.length > 0)
    ? userLevels
    : (classifierLevels || []);

  if (provided.length === 0) {
    // No level guidance at all. Cannot parse hierarchically; caller falls back.
    return { resolvedLevels: [], resolvedColumnIndices: [], unresolvedLevels: [] };
  }

  const headerIndexByName = new Map<string, number>();
  headerRow.forEach((h, i) => {
    if (h && !headerIndexByName.has(normalize(h))) {
      headerIndexByName.set(normalize(h), i);
    }
  });

  const resolvedColumnIndices: number[] = [];
  const unresolvedLevels: string[] = [];
  const usedColumnIndices = new Set<number>();

  provided.forEach((levelName, levelIdx) => {
    const headerMatch = headerIndexByName.get(normalize(levelName));
    if (headerMatch != null && !usedColumnIndices.has(headerMatch)) {
      resolvedColumnIndices.push(headerMatch);
      usedColumnIndices.add(headerMatch);
      return;
    }
    // Fallback: ordinal position
    if (levelIdx < totalColumns && !usedColumnIndices.has(levelIdx)) {
      resolvedColumnIndices.push(levelIdx);
      usedColumnIndices.add(levelIdx);
      return;
    }
    // Could not resolve
    resolvedColumnIndices.push(-1);
    unresolvedLevels.push(levelName);
  });

  return {
    resolvedLevels: provided.slice(),
    resolvedColumnIndices,
    unresolvedLevels,
  };
}

/**
 * Parse one sheet using the unified Pattern B/C algorithm.
 */
export function parseHierarchicalColumns(
  sheet: ParsedSheet,
  sheetClassification: SheetClassification,
  userLevels?: string[],
): ParseHierarchicalResult {
  const structure = sheetClassification.structure || ({} as SheetClassificationStructure);
  const headerRowIndex = structure.header_row_index ?? SHEET_DEFAULT_HEADER_ROW;
  const dataStartRow = structure.data_starts_at_row ?? SHEET_DEFAULT_DATA_ROW;
  const hierarchySignal = (structure.hierarchy_signal || 'column_nested') as HierarchySignal;
  const classifierLevels = structure.implied_levels || [];

  const headerRow = readHeaderRow(sheet, headerRowIndex);
  const totalColumns = Math.max(sheet.columnCount, headerRow.length);

  const resolution = resolveHierarchyColumns(
    headerRow,
    userLevels,
    classifierLevels,
    totalColumns,
  );

  console.log(
    '[ssphase4b] resolve-levels:',
    JSON.stringify({
      sheet: sheet.name,
      provided: userLevels && userLevels.length > 0 ? userLevels : classifierLevels,
      source: userLevels && userLevels.length > 0 ? 'user' : 'classifier',
      resolvedLevels: resolution.resolvedLevels,
      resolvedColumnIndices: resolution.resolvedColumnIndices,
      unresolved: resolution.unresolvedLevels,
    }),
  );

  // If we couldn't resolve any hierarchy column, return empty + unresolved
  // signal so the caller can prompt the user (4b.2) or fall back.
  const usableHierarchy = resolution.resolvedColumnIndices.filter(i => i >= 0);
  if (usableHierarchy.length === 0) {
    console.log('[ssphase4b] hierarchy: levels=[] resolved=[] unresolved=', resolution.unresolvedLevels);
    return {
      items: [],
      personMappings: [],
      allColumnHeaders: headerRow.filter(Boolean),
      unresolvedLevels: resolution.unresolvedLevels,
      resolvedLevels: resolution.resolvedLevels,
      resolvedColumnIndices: resolution.resolvedColumnIndices,
    };
  }

  const hierarchyColSet = new Set(resolution.resolvedColumnIndices.filter(i => i >= 0));

  // Map non-hierarchy columns → role from existing helper.
  const nonHierarchyColumns: Array<{ index: number; header: string; role: ColumnRole }> = [];
  headerRow.forEach((h, idx) => {
    if (!h) return;
    if (hierarchyColSet.has(idx)) return;
    nonHierarchyColumns.push({ index: idx, header: h, role: getDefaultColumnRole(h) });
  });

  const findColIndexByRole = (role: ColumnRole): number | null => {
    const m = nonHierarchyColumns.find(c => c.role === role);
    return m ? m.index : null;
  };
  const findAllColIndicesByRole = (role: ColumnRole): number[] =>
    nonHierarchyColumns.filter(c => c.role === role).map(c => c.index);

  const ownerIdx = findColIndexByRole('owner');
  const dateIdx = findColIndexByRole('date');
  const metricIdx = findColIndexByRole('metric');
  const descIdx = findColIndexByRole('description');
  const tagIdx = findColIndexByRole('tag');
  const memberIndices = findAllColIndicesByRole('member');

  // Walk data rows, tracking last-non-blank per hierarchy column for inheritance.
  const lastNonBlank: Array<string | null> = resolution.resolvedColumnIndices.map(() => null);
  // Parent dedupe key: `${depth}|${normalized-path-up-to-depth}` → PlanItem
  const parentByKey = new Map<string, PlanItem>();
  const items: PlanItem[] = [];
  const personNames = new Set<string>();
  let orderCounter = 0;

  const isCategoryColumns = hierarchySignal === 'category_columns';

  const cellAt = (row: (string | number | null)[], idx: number): string => {
    if (idx < 0 || idx >= row.length) return '';
    const v = row[idx];
    return v == null ? '' : String(v).trim();
  };

  const sourceSheet = sheet.name;
  const baseTags = sourceSheet ? [`Source: ${sourceSheet}`] : [];

  for (let r = dataStartRow; r < sheet.rows.length; r++) {
    const row = sheet.rows[r];
    if (!Array.isArray(row)) continue;

    // Skip fully empty rows.
    const anyFilled = row.some(c => c != null && String(c).trim() !== '');
    if (!anyFilled) continue;

    // Read raw hierarchy values for this row.
    const rawValues: string[] = resolution.resolvedColumnIndices.map(colIdx =>
      colIdx >= 0 ? cellAt(row, colIdx) : '',
    );

    // Inheritance fill: any blank inherits from the last seen non-blank above.
    const filled: string[] = rawValues.map((v, i) => {
      if (v) {
        lastNonBlank[i] = v;
        return v;
      }
      return lastNonBlank[i] || '';
    });

    // Determine leaf depth for this row.
    let leafDepthIdx = -1;
    if (isCategoryColumns) {
      // Pattern B: leaf is the deepest non-blank RAW cell for this row.
      // (Inherited values represent ancestors, not the row's own leaf.)
      for (let i = rawValues.length - 1; i >= 0; i--) {
        if (rawValues[i]) { leafDepthIdx = i; break; }
      }
      // If row had no raw hierarchy values, it's an attribute-only row — skip.
      if (leafDepthIdx < 0) continue;
    } else {
      // Pattern C: leaf is the deepest configured level. Need that cell present
      // (after inheritance). If still empty, skip — row had nothing to anchor.
      leafDepthIdx = filled.length - 1;
      if (!filled[leafDepthIdx]) continue;
    }

    // Build / reuse parent items for depths 0..leafDepthIdx-1, then create the leaf at leafDepthIdx.
    let parentId: string | null = null;
    for (let d = 0; d <= leafDepthIdx; d++) {
      const value = filled[d];
      if (!value) {
        // Pattern B partial path: gap means "no node at this depth". Just skip.
        // The next deeper level (if present) will dangle off the most recent real parent.
        continue;
      }

      const isLeaf = d === leafDepthIdx;
      // Whitespace-collapse + lowercase for dedupe only; storage keeps original `value`.
      const pathKey = filled
        .slice(0, d + 1)
        .map(v => normalizeWhitespace(v).toLowerCase())
        .join(' > ');
      const dedupeKey = `${d}|${pathKey}`;

      // Leaves are ALWAYS unique (each data row is its own leaf, even if name repeats).
      // Parents are deduped by (depth + path).
      if (!isLeaf) {
        const existing = parentByKey.get(dedupeKey);
        if (existing) {
          parentId = existing.id;
          continue;
        }
      }

      orderCounter++;
      const levelName = resolution.resolvedLevels[d] || `Level ${d + 1}`;
      const item = createEmptyPlanItem({
        id: crypto.randomUUID(),
        order: String(orderCounter),
        levelName,
        levelDepth: d + 1,
        name: value,
        parentId,
        confidence: 100,
        tags: baseTags.slice(),
      });

      if (isLeaf) {
        // Attach attributes only to the leaf.
        if (ownerIdx != null) {
          const owner = cellAt(row, ownerIdx);
          if (owner) {
            item.assignedTo = owner;
            personNames.add(owner);
          }
        }
        if (dateIdx != null) {
          const raw = cellAt(row, dateIdx);
          item.dueDate = parseSpreadsheetDate(raw) || '';
        }
        if (descIdx != null) {
          item.description = cellAt(row, descIdx);
        }
        if (tagIdx != null) {
          const t = cellAt(row, tagIdx);
          if (t) item.tags.push(t);
        }
        if (metricIdx != null) {
          const m = cellAt(row, metricIdx);
          if (m) {
            item.metricDescription = 'Track to Target';
            item.metricTarget = m;
          }
        }
        for (const mIdx of memberIndices) {
          const mv = cellAt(row, mIdx);
          if (mv) item.members.push(mv);
        }
      }

      items.push(item);
      if (!isLeaf) {
        parentByKey.set(dedupeKey, item);
        parentId = item.id;
      }
    }
  }

  const parentsCreated = parentByKey.size;
  const leafItems = items.length - parentsCreated;
  console.log(
    '[ssphase4b] parsed:',
    JSON.stringify({
      sheet: sheet.name,
      pattern: sheetClassification.pattern,
      items: items.length,
      leaves: leafItems,
      parentsCreated,
    }),
  );
  console.log(
    '[ssphase4b] hierarchy:',
    JSON.stringify({
      sheet: sheet.name,
      levels: resolution.resolvedLevels,
      resolved: resolution.resolvedColumnIndices,
      unresolved: resolution.unresolvedLevels,
    }),
  );

  const personMappings: PersonMapping[] = Array.from(personNames).map((name, i) => ({
    id: String(i + 1),
    foundName: name,
    email: '',
    isResolved: false,
  }));

  return {
    items,
    personMappings,
    allColumnHeaders: headerRow.filter(Boolean),
    unresolvedLevels: resolution.unresolvedLevels.length > 0 ? resolution.unresolvedLevels : undefined,
    resolvedLevels: resolution.resolvedLevels,
    resolvedColumnIndices: resolution.resolvedColumnIndices,
  };
}
