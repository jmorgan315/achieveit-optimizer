import * as XLSX from 'xlsx';
import { PlanItem, PlanLevel, PersonMapping } from '@/types/plan';

export interface ParsedSheet {
  name: string;
  rows: (string | number | null)[][];
  columnCount: number;
  rowCount: number;
}

export interface DetectedSection {
  headerText: string;
  headerRowIndex: number;
  columnHeaders: string[];
  columnHeaderRowIndex: number;
  dataRowStart: number;
  dataRowEnd: number;
  dataRowCount: number;
}

export interface SheetDetection {
  sheet: ParsedSheet;
  sections: DetectedSection[];
  allColumnHeaders: string[];
  totalDataRows: number;
}

export interface StructureDetection {
  sheets: SheetDetection[];
  totalSheets: number;
  totalItems: number;
  totalSections: number;
  recommendedSheetIndex: number;
}

export type ColumnRole = 'item_name' | 'owner' | 'date' | 'metric' | 'description' | 'tag' | 'skip';
export type ElementRole = { type: 'level'; depth: number } | { type: 'tag' } | { type: 'skip' };

export interface MappingConfig {
  selectedSheetIndex: number;
  sectionMapping: ElementRole; // how section headers map
  columnMappings: Record<string, ColumnRole>;
  levels: PlanLevel[];
}

// ─── Parsing ────────────────────────────────────────────────────

export async function parseSpreadsheetFile(file: File): Promise<ParsedSheet[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });

  return workbook.SheetNames.flatMap(name => {
    const ws = workbook.Sheets[name];
    if (!ws?.['!ref']) return [];
    const json = (XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: null,
      blankrows: false,
    }) as (string | number | null)[][]).filter((row): row is (string | number | null)[] => Array.isArray(row));
    const columnCount = json.reduce((max, row) => Math.max(max, row?.length ?? 0), 0);
    return [{ name, rows: json, columnCount, rowCount: json.length }];
  });
}

// ─── Structure Detection ────────────────────────────────────────

function isLikelyColumnHeaderRow(row: (string | number | null)[]): boolean {
  if (!Array.isArray(row)) return false;
  const filled = row.filter(c => c != null && String(c).trim().length > 0);
  if (filled.length < 2) return false;
  const allShort = filled.every(c => String(c).trim().length < 40);
  return allShort && filled.length >= 2;
}

function isLikelySectionHeader(row: (string | number | null)[], avgCols: number): boolean {
  const filled = row.filter(c => c != null && String(c).trim().length > 0);
  if (filled.length !== 1 && filled.length !== 2) return false;
  const text = String(filled[0]).trim();
  return text.length > 3 && text.length < 200 && avgCols > 2;
}

export function detectStructure(sheets: ParsedSheet[]): StructureDetection {
  const detections: SheetDetection[] = sheets.map(sheet => {
    const { rows } = sheet;
    const avgCols = rows.length > 0
      ? rows.reduce((s, r) => s + r.filter(c => c != null && String(c).trim() !== '').length, 0) / rows.length
      : 0;

    const sections: DetectedSection[] = [];
    const allColumnHeaders: string[] = [];
    let i = 0;

    while (i < rows.length) {
      // Look for section header
      if (isLikelySectionHeader(rows[i], avgCols)) {
        const headerText = String(rows[i].find(c => c != null && String(c).trim() !== '') || '').trim();
        const headerRowIndex = i;
        i++;

        // Look for column header row
        if (i < rows.length && isLikelyColumnHeaderRow(rows[i])) {
          const colHeaders = rows[i]
            .map(c => (c != null ? String(c).trim() : ''))
            .filter(s => s.length > 0);
          const columnHeaderRowIndex = i;
          i++;

          // Collect data rows
          const dataRowStart = i;
          while (i < rows.length && !isLikelySectionHeader(rows[i], avgCols)) {
            const filled = rows[i].filter(c => c != null && String(c).trim() !== '');
            if (filled.length === 0) { i++; continue; }
            if (isLikelyColumnHeaderRow(rows[i]) && i > dataRowStart + 1) break;
            i++;
          }

          sections.push({
            headerText,
            headerRowIndex,
            columnHeaders: colHeaders,
            columnHeaderRowIndex,
            dataRowStart,
            dataRowEnd: i,
            dataRowCount: i - dataRowStart,
          });

          colHeaders.forEach(h => {
            if (!allColumnHeaders.includes(h)) allColumnHeaders.push(h);
          });
          continue;
        }
      }

      // No section header — check for standalone column header row
      if (isLikelyColumnHeaderRow(rows[i]) && sections.length === 0 && allColumnHeaders.length === 0) {
        const colHeaders = rows[i]
          .map(c => (c != null ? String(c).trim() : ''))
          .filter(s => s.length > 0);
        const columnHeaderRowIndex = i;
        i++;
        const dataRowStart = i;
        while (i < rows.length) {
          const filled = rows[i].filter(c => c != null && String(c).trim() !== '');
          if (filled.length === 0) { i++; continue; }
          if (isLikelySectionHeader(rows[i], avgCols)) break;
          i++;
        }
        sections.push({
          headerText: '',
          headerRowIndex: -1,
          columnHeaders: colHeaders,
          columnHeaderRowIndex,
          dataRowStart,
          dataRowEnd: i,
          dataRowCount: i - dataRowStart,
        });
        colHeaders.forEach(h => {
          if (!allColumnHeaders.includes(h)) allColumnHeaders.push(h);
        });
        continue;
      }

      i++;
    }

    // Fallback: if no sections detected, treat entire sheet as one section
    if (sections.length === 0 && rows.length > 1) {
      const firstRow = rows[0];
      const colHeaders = firstRow
        .map(c => (c != null ? String(c).trim() : ''))
        .filter(s => s.length > 0);

      sections.push({
        headerText: '',
        headerRowIndex: -1,
        columnHeaders: colHeaders,
        columnHeaderRowIndex: 0,
        dataRowStart: 1,
        dataRowEnd: rows.length,
        dataRowCount: rows.length - 1,
      });
      colHeaders.forEach(h => {
        if (!allColumnHeaders.includes(h)) allColumnHeaders.push(h);
      });
    }

    const totalDataRows = sections.reduce((s, sec) => s + sec.dataRowCount, 0);
    return { sheet, sections, allColumnHeaders, totalDataRows };
  });

  // Recommend the sheet with the most data rows
  let recommendedIdx = 0;
  let maxRows = 0;
  detections.forEach((d, idx) => {
    if (d.totalDataRows > maxRows) {
      maxRows = d.totalDataRows;
      recommendedIdx = idx;
    }
  });

  return {
    sheets: detections,
    totalSheets: sheets.length,
    totalItems: detections.reduce((s, d) => s + d.totalDataRows, 0),
    totalSections: detections.reduce((s, d) => s + d.sections.length, 0),
    recommendedSheetIndex: recommendedIdx,
  };
}

// ─── Smart Column Defaults ──────────────────────────────────────

const COLUMN_PATTERNS: [RegExp, ColumnRole][] = [
  [/action|description|initiative|activity|task|item\s*name|objective|goal/i, 'item_name'],
  [/owner|sponsor|responsible|assigned|lead/i, 'owner'],
  [/deadline|timeframe|due|date|timeline|target\s*date/i, 'date'],
  [/outcome|measurement|metric|kpi|measure|indicator/i, 'metric'],
  [/department|division|unit|area|pillar/i, 'tag'],
  [/budget|cost|q[1-4]|quarter/i, 'skip'],
];

export function getDefaultColumnRole(columnName: string): ColumnRole {
  const lower = columnName.toLowerCase().trim();
  for (const [pattern, role] of COLUMN_PATTERNS) {
    if (pattern.test(lower)) return role;
  }
  return 'skip';
}

// ─── Plan Item Generation ───────────────────────────────────────

export function generatePlanItems(
  detection: SheetDetection,
  mapping: MappingConfig,
): { items: PlanItem[]; personMappings: PersonMapping[] } {
  const items: PlanItem[] = [];
  const personNames = new Set<string>();
  const { sheet, sections } = detection;
  const { columnMappings, sectionMapping, levels } = mapping;

  // Build column index map from the first section's column headers
  const colIndexMap = new Map<string, number>();
  if (sections.length > 0) {
    const refHeaders = sections[0].columnHeaders;
    const headerRow = sheet.rows[sections[0].columnHeaderRowIndex];
    if (headerRow) {
      headerRow.forEach((cell, idx) => {
        const val = cell != null ? String(cell).trim() : '';
        if (val && refHeaders.includes(val)) {
          colIndexMap.set(val, idx);
        }
      });
    }
  }

  const getColumnValue = (row: (string | number | null)[], colName: string): string => {
    const idx = colIndexMap.get(colName);
    if (idx == null) return '';
    const val = row[idx];
    return val != null ? String(val).trim() : '';
  };

  const findColumnByRole = (role: ColumnRole): string | null => {
    for (const [col, r] of Object.entries(columnMappings)) {
      if (r === role) return col;
    }
    return null;
  };

  const nameCol = findColumnByRole('item_name');
  const ownerCol = findColumnByRole('owner');
  const dateCol = findColumnByRole('date');
  const metricCol = findColumnByRole('metric');
  const descCol = findColumnByRole('description');
  const tagCol = findColumnByRole('tag');

  const useSectionAsLevel = sectionMapping.type === 'level';
  const sectionDepth = useSectionAsLevel ? sectionMapping.depth : 0;

  // Determine data item depth
  const dataDepth = useSectionAsLevel ? sectionDepth + 1 : 1;
  const dataLevelName = levels.find(l => l.depth === dataDepth)?.name || `Level ${dataDepth}`;

  let orderCounter = 0;

  for (const section of sections) {
    let sectionItemId: string | null = null;

    // Create section header as a plan item if mapped to a level
    if (useSectionAsLevel && section.headerText) {
      orderCounter++;
      const sectionLevelName = levels.find(l => l.depth === sectionDepth)?.name || `Level ${sectionDepth}`;
      const sectionItem: PlanItem = createEmptyPlanItem({
        id: crypto.randomUUID(),
        order: String(orderCounter),
        levelName: sectionLevelName,
        levelDepth: sectionDepth,
        name: section.headerText,
        parentId: null,
        confidence: 100,
      });
      items.push(sectionItem);
      sectionItemId = sectionItem.id;
    }

    // Process data rows
    for (let r = section.dataRowStart; r < section.dataRowEnd; r++) {
      const row = sheet.rows[r];
      if (!row) continue;

      const filled = row.filter(c => c != null && String(c).trim() !== '');
      if (filled.length === 0) continue;

      const name = nameCol ? getColumnValue(row, nameCol) : '';
      if (!name) continue;

      orderCounter++;
      const owner = ownerCol ? getColumnValue(row, ownerCol) : '';
      const dueDate = dateCol ? getColumnValue(row, dateCol) : '';
      const metric = metricCol ? getColumnValue(row, metricCol) : '';
      const desc = descCol ? getColumnValue(row, descCol) : '';
      const tag = tagCol ? getColumnValue(row, tagCol) : '';

      if (owner) personNames.add(owner);

      const item: PlanItem = createEmptyPlanItem({
        id: crypto.randomUUID(),
        order: String(orderCounter),
        levelName: dataLevelName,
        levelDepth: dataDepth,
        name,
        description: desc,
        assignedTo: owner,
        dueDate,
        parentId: sectionItemId,
        tags: tag ? [tag] : [],
        confidence: 100,
      });

      if (metric) {
        item.metricDescription = 'Track to Target';
        item.metricTarget = metric;
      }

      items.push(item);
    }
  }

  // Simple dedup: name+parent
  const seen = new Map<string, number>();
  const deduped: PlanItem[] = [];
  for (const item of items) {
    const key = `${item.name.toLowerCase().trim()}|${item.parentId || ''}`;
    if (!seen.has(key)) {
      seen.set(key, deduped.length);
      deduped.push(item);
    }
  }

  // Build person mappings
  const personMappings: PersonMapping[] = Array.from(personNames).map((name, i) => ({
    id: String(i + 1),
    foundName: name,
    email: '',
    isResolved: false,
  }));

  return { items: deduped, personMappings };
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
