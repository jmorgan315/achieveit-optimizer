import * as XLSX from 'xlsx';
import { PlanItem, PlanLevel, PersonMapping } from '@/types/plan';

/** Safely parse a spreadsheet date cell (Excel serial, ISO string, locale string) into YYYY-MM-DD or undefined */
export function parseSpreadsheetDate(v: unknown): string | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number') {
    // Excel serial date: days since 1900-01-01 (with the 1900 leap year bug)
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return undefined;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  // Try DD/MM/YYYY or DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (!m) return undefined;
  const d2 = new Date(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
  return Number.isNaN(d2.getTime()) ? undefined : d2.toISOString().slice(0, 10);
}

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
  sectionType: 'strategy' | 'outcome' | 'generic';
  outcomeText?: string;
  outcomeRowIndex?: number;
}

export interface SheetDetection {
  sheet: ParsedSheet;
  sections: DetectedSection[];
  allColumnHeaders: string[];
  totalDataRows: number;
  hasStrategyPattern: boolean;
}

export interface StructureDetection {
  sheets: SheetDetection[];
  totalSheets: number;
  totalItems: number;
  totalSections: number;
  recommendedSheetIndex: number;
  hasStrategyPattern: boolean;
}

export type ColumnRole = 'item_name' | 'owner' | 'date' | 'metric' | 'description' | 'tag' | 'member' | 'skip';
export type ElementRole = { type: 'level'; depth: number } | { type: 'tag' } | { type: 'skip' };

export type MeasurementMode = 'level4' | 'metric_on_parent';

export interface MappingConfig {
  selectedSheetIndices: number[];
  sectionMapping: ElementRole;
  columnMappings: Record<string, ColumnRole>;
  levels: PlanLevel[];
  measurementMode: MeasurementMode;
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

// ─── Strategy Pattern Helpers ───────────────────────────────────

function isStrategyRow(row: (string | number | null)[] | undefined): boolean {
  if (!Array.isArray(row)) return false;
  const cellA = row[0];
  if (cellA == null) return false;
  return /^strategy\s*:/i.test(String(cellA).trim());
}

function isOutcomeRow(row: (string | number | null)[] | undefined): boolean {
  if (!Array.isArray(row)) return false;
  const cellA = row[0];
  if (cellA == null) return false;
  return /^outcomes?\s*$/i.test(String(cellA).trim()) || /^outcomes?\s*:/i.test(String(cellA).trim());
}

function getStrategyName(row: (string | number | null)[]): string {
  const cellA = String(row[0] || '').trim();
  // Extract text after "Strategy:"
  const match = cellA.match(/^strategy\s*:\s*(.+)/i);
  return match ? match[1].trim().replace(/[-–—]+$/, '').trim() : cellA;
}

function getOutcomeText(row: (string | number | null)[]): string {
  // Outcome text is typically in column B
  const cellB = row[1];
  if (cellB != null && String(cellB).trim()) return String(cellB).trim();
  // Fallback to column A content after "Outcomes"
  const cellA = String(row[0] || '').trim();
  const match = cellA.match(/^outcomes?\s*:\s*(.+)/i);
  return match ? match[1].trim() : cellA;
}

// ─── Structure Detection ────────────────────────────────────────

function isLikelyColumnHeaderRow(row: (string | number | null)[] | undefined): boolean {
  if (!Array.isArray(row)) return false;
  const filled = row.filter(c => c != null && String(c).trim().length > 0);
  if (filled.length < 2) return false;
  const allShort = filled.every(c => String(c).trim().length < 40);
  return allShort && filled.length >= 2;
}

function isLikelySectionHeader(row: (string | number | null)[] | undefined, avgCols: number): boolean {
  if (!Array.isArray(row)) return false;
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

    // First pass: check if this sheet has a strategy pattern
    const hasStrategy = rows.some(r => isStrategyRow(r));

    if (hasStrategy) {
      return detectStrategyPattern(sheet, rows);
    }

    // Fallback: generic detection (original logic)
    return detectGenericPattern(sheet, rows, avgCols);
  });

  const hasStrategyPattern = detections.some(d => d.hasStrategyPattern);

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
    hasStrategyPattern,
  };
}

function detectStrategyPattern(sheet: ParsedSheet, rows: (string | number | null)[][]): SheetDetection {
  const sections: DetectedSection[] = [];
  const allColumnHeaders: string[] = [];
  let i = 0;

  while (i < rows.length) {
    if (!Array.isArray(rows[i])) { i++; continue; }

    if (isStrategyRow(rows[i])) {
      const strategyName = getStrategyName(rows[i]);
      const strategyRowIdx = i;
      i++;

      // Look for Outcome row
      let outcomeText = '';
      let outcomeRowIdx = -1;
      if (i < rows.length && isOutcomeRow(rows[i])) {
        outcomeText = getOutcomeText(rows[i]);
        outcomeRowIdx = i;
        i++;
      }

      // Look for column header row
      let colHeaders: string[] = [];
      let columnHeaderRowIndex = -1;
      if (i < rows.length && isLikelyColumnHeaderRow(rows[i])) {
        colHeaders = rows[i]
          .map(c => (c != null ? String(c).trim() : ''))
          .filter(s => s.length > 0);
        columnHeaderRowIndex = i;
        i++;
      }

      // Collect data rows until next strategy row or end
      const dataRowStart = i;
      while (i < rows.length && !isStrategyRow(rows[i])) {
        i++;
      }

      // Trim trailing empty rows
      let dataRowEnd = i;
      while (dataRowEnd > dataRowStart) {
        const row = rows[dataRowEnd - 1];
        if (Array.isArray(row) && row.some(c => c != null && String(c).trim() !== '')) break;
        dataRowEnd--;
      }

      sections.push({
        headerText: strategyName,
        headerRowIndex: strategyRowIdx,
        columnHeaders: colHeaders,
        columnHeaderRowIndex,
        dataRowStart,
        dataRowEnd,
        dataRowCount: dataRowEnd - dataRowStart,
        sectionType: 'strategy',
        outcomeText,
        outcomeRowIndex: outcomeRowIdx >= 0 ? outcomeRowIdx : undefined,
      });

      colHeaders.forEach(h => {
        if (!allColumnHeaders.includes(h)) allColumnHeaders.push(h);
      });
      continue;
    }

    i++;
  }

  const totalDataRows = sections.reduce((s, sec) => s + sec.dataRowCount, 0);
  return { sheet, sections, allColumnHeaders, totalDataRows, hasStrategyPattern: true };
}

function detectGenericPattern(sheet: ParsedSheet, rows: (string | number | null)[][], avgCols: number): SheetDetection {
  const sections: DetectedSection[] = [];
  const allColumnHeaders: string[] = [];
  let i = 0;

  while (i < rows.length) {
    if (!Array.isArray(rows[i])) { i++; continue; }

    if (isLikelySectionHeader(rows[i], avgCols)) {
      const headerText = String(rows[i].find(c => c != null && String(c).trim() !== '') || '').trim();
      const headerRowIndex = i;
      i++;

      if (i < rows.length && isLikelyColumnHeaderRow(rows[i])) {
        const colHeaders = rows[i]
          .map(c => (c != null ? String(c).trim() : ''))
          .filter(s => s.length > 0);
        const columnHeaderRowIndex = i;
        i++;

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
          sectionType: 'generic',
        });
        colHeaders.forEach(h => {
          if (!allColumnHeaders.includes(h)) allColumnHeaders.push(h);
        });
        continue;
      }
    }

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
        sectionType: 'generic',
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
      sectionType: 'generic',
    });
    colHeaders.forEach(h => {
      if (!allColumnHeaders.includes(h)) allColumnHeaders.push(h);
    });
  }

  const totalDataRows = sections.reduce((s, sec) => s + sec.dataRowCount, 0);
  return { sheet, sections, allColumnHeaders, totalDataRows, hasStrategyPattern: false };
}

// ─── Multi-Sheet Merge ──────────────────────────────────────────

export function mergeSheetDetections(detections: SheetDetection[]): SheetDetection {
  if (detections.length === 0) {
    return {
      sheet: { name: 'Merged', rows: [], columnCount: 0, rowCount: 0 },
      sections: [],
      allColumnHeaders: [],
      totalDataRows: 0,
      hasStrategyPattern: false,
    };
  }
  if (detections.length === 1) return detections[0];

  // Use first detection as base
  const allSections: DetectedSection[] = [];
  const allColumnHeaders: string[] = [];
  let totalDataRows = 0;
  const hasStrategy = detections.some(d => d.hasStrategyPattern);

  // Merge all rows from all sheets for reference (needed for column value lookups)
  const mergedRows: (string | number | null)[][] = [];
  const sheetRowOffsets: { sheetName: string; offset: number; detection: SheetDetection }[] = [];

  for (const det of detections) {
    const offset = mergedRows.length;
    sheetRowOffsets.push({ sheetName: det.sheet.name, offset, detection: det });
    mergedRows.push(...det.sheet.rows);

    for (const sec of det.sections) {
      // Offset row indices for merged context
      allSections.push({
        ...sec,
        headerRowIndex: sec.headerRowIndex >= 0 ? sec.headerRowIndex + offset : -1,
        columnHeaderRowIndex: sec.columnHeaderRowIndex >= 0 ? sec.columnHeaderRowIndex + offset : -1,
        dataRowStart: sec.dataRowStart + offset,
        dataRowEnd: sec.dataRowEnd + offset,
        // Store source sheet name in headerText prefix for tag generation
        _sourceSheet: det.sheet.name,
      } as DetectedSection & { _sourceSheet?: string });
      totalDataRows += sec.dataRowCount;
    }

    det.allColumnHeaders.forEach(h => {
      if (!allColumnHeaders.includes(h)) allColumnHeaders.push(h);
    });
  }

  return {
    sheet: { name: 'Merged', rows: mergedRows, columnCount: Math.max(...detections.map(d => d.sheet.columnCount)), rowCount: mergedRows.length },
    sections: allSections,
    allColumnHeaders,
    totalDataRows,
    hasStrategyPattern: hasStrategy,
  };
}

// ─── Smart Column Defaults ──────────────────────────────────────

const COLUMN_PATTERNS: [RegExp, ColumnRole][] = [
  [/action|description|initiative|activity|task|item\s*name|objective|goal/i, 'item_name'],
  [/owner|sponsor|responsible|assigned|lead/i, 'owner'],
  [/deadline|timeframe|due|date|timeline|target\s*date/i, 'date'],
  [/outcome|measurement|metric|kpi|measure|indicator/i, 'metric'],
  [/department|member|team|division|unit/i, 'member'],
  [/area|pillar/i, 'tag'],
  [/budget|cost|q[1-4]|quarter/i, 'skip'],
];

export function getDefaultColumnRole(columnName: string): ColumnRole {
  const lower = columnName.toLowerCase().trim();
  for (const [pattern, role] of COLUMN_PATTERNS) {
    if (pattern.test(lower)) return role;
  }
  return 'skip';
}

// ─── Default Selection Logic ────────────────────────────────────

export function getDefaultSheetSelection(sheets: SheetDetection[]): number[] {
  // Check for rollup sheets
  const rollupPattern = /enterprise|all\s|summary|consolidated/i;
  const rollupIdx = sheets.findIndex(s => rollupPattern.test(s.sheet.name));
  if (rollupIdx >= 0) return [rollupIdx];
  // Otherwise select all
  return sheets.map((_, i) => i);
}

// ─── Strategy-Pattern Levels ────────────────────────────────────

export const STRATEGY_LEVELS: PlanLevel[] = [
  { id: '1', name: 'Strategy', depth: 1 },
  { id: '2', name: 'Outcome', depth: 2 },
  { id: '3', name: 'Action', depth: 3 },
  { id: '4', name: 'Measurement', depth: 4 },
];

// ─── Plan Item Generation ───────────────────────────────────────

export function generatePlanItems(
  detection: SheetDetection,
  mapping: MappingConfig,
): { items: PlanItem[]; personMappings: PersonMapping[] } {
  const items: PlanItem[] = [];
  const personNames = new Set<string>();
  const { sheet, sections, hasStrategyPattern } = detection;
  const { columnMappings, sectionMapping, levels, measurementMode } = mapping;

  // Build column index map from the first section's column headers
  const colIndexMap = new Map<string, number>();
  const refSection = sections.find(s => s.columnHeaders.length > 0);
  if (refSection) {
    const headerRow = sheet.rows[refSection.columnHeaderRowIndex];
    if (headerRow) {
      headerRow.forEach((cell, idx) => {
        const val = cell != null ? String(cell).trim() : '';
        if (val && refSection.columnHeaders.includes(val)) {
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

  const findAllColumnsByRole = (role: ColumnRole): string[] => {
    return Object.entries(columnMappings).filter(([, r]) => r === role).map(([col]) => col);
  };

  const nameCol = findColumnByRole('item_name');
  const ownerCol = findColumnByRole('owner');
  const dateCol = findColumnByRole('date');
  const metricCol = findColumnByRole('metric');
  const descCol = findColumnByRole('description');
  const tagCol = findColumnByRole('tag');
  const memberCols = findAllColumnsByRole('member');

  let orderCounter = 0;

  // Get source sheet name from the section (if merged)
  const getSourceSheet = (section: DetectedSection): string => {
    return (section as any)._sourceSheet || sheet.name || '';
  };

  if (hasStrategyPattern) {
    // Strategy pattern: Strategy → Outcome → Action → Measurement
    // Find-or-create maps for cross-sheet dedup of Level 1 and Level 2
    const strategyMap = new Map<string, PlanItem>();
    const outcomeMap = new Map<string, PlanItem>();

    for (const section of sections) {
      if (section.sectionType !== 'strategy') continue;

      const sourceSheet = getSourceSheet(section);
      const strategyLevelName = levels.find(l => l.depth === 1)?.name || 'Strategy';
      const strategyKey = section.headerText.toLowerCase().trim();

      // Find or create Strategy item (Level 1)
      let strategyItem = strategyMap.get(strategyKey);
      if (!strategyItem) {
        orderCounter++;
        strategyItem = createEmptyPlanItem({
          id: crypto.randomUUID(),
          order: String(orderCounter),
          levelName: strategyLevelName,
          levelDepth: 1,
          name: section.headerText,
          parentId: null,
          confidence: 100,
          tags: sourceSheet ? [`Source: ${sourceSheet}`] : [],
        });
        items.push(strategyItem);
        strategyMap.set(strategyKey, strategyItem);
      }

      // Find or create Outcome item (Level 2)
      let outcomeItemId: string | null = null;
      if (section.outcomeText) {
        const outcomeKey = `${section.outcomeText.toLowerCase().trim()}|${strategyItem.id}`;
        let outcomeItem = outcomeMap.get(outcomeKey);
        if (!outcomeItem) {
          orderCounter++;
          const outcomeLevelName = levels.find(l => l.depth === 2)?.name || 'Outcome';
          outcomeItem = createEmptyPlanItem({
            id: crypto.randomUUID(),
            order: String(orderCounter),
            levelName: outcomeLevelName,
            levelDepth: 2,
            name: section.outcomeText,
            parentId: strategyItem.id,
            confidence: 100,
            tags: sourceSheet ? [`Source: ${sourceSheet}`] : [],
          });
          items.push(outcomeItem);
          outcomeMap.set(outcomeKey, outcomeItem);
        }
        outcomeItemId = outcomeItem.id;
      }

      // Level 3: Actions — always unique per sheet
      const sectionColMap = new Map<string, number>(colIndexMap);
      if (section.columnHeaders.length > 0 && section.columnHeaderRowIndex >= 0) {
        const hRow = sheet.rows[section.columnHeaderRowIndex];
        if (hRow) {
          sectionColMap.clear();
          hRow.forEach((cell, idx) => {
            const val = cell != null ? String(cell).trim() : '';
            if (val) sectionColMap.set(val, idx);
          });
        }
      }

      const getSectionColValue = (row: (string | number | null)[], colName: string): string => {
        const idx = sectionColMap.get(colName);
        if (idx == null) return '';
        const val = row[idx];
        return val != null ? String(val).trim() : '';
      };

      for (let r = section.dataRowStart; r < section.dataRowEnd; r++) {
        const row = sheet.rows[r];
        if (!row) continue;
        if (isStrategyRow(row) || isOutcomeRow(row)) continue;
        if (isLikelyColumnHeaderRow(row) && r === section.columnHeaderRowIndex) continue;

        const filled = row.filter(c => c != null && String(c).trim() !== '');
        if (filled.length === 0) continue;

        const name = nameCol ? getSectionColValue(row, nameCol) : '';
        if (!name) continue;

        orderCounter++;
        const owner = ownerCol ? getSectionColValue(row, ownerCol) : '';
        const dueDate = dateCol ? getSectionColValue(row, dateCol) : '';
        const metricVal = metricCol ? getSectionColValue(row, metricCol) : '';
        const desc = descCol ? getSectionColValue(row, descCol) : '';
        const tag = tagCol ? getSectionColValue(row, tagCol) : '';

        if (owner) personNames.add(owner);

        const actionLevelName = levels.find(l => l.depth === 3)?.name || 'Action';
        const tags: string[] = [];
        if (tag) tags.push(tag);
        if (sourceSheet) tags.push(`Source: ${sourceSheet}`);

        // Collect member values, fall back to sheet name if empty
        const members: string[] = [];
        for (const mc of memberCols) {
          const mv = getSectionColValue(row, mc);
          if (mv) members.push(mv);
        }
        if (members.length === 0 && sourceSheet) {
          members.push(sourceSheet);
        }

        const actionItem: PlanItem = createEmptyPlanItem({
          id: crypto.randomUUID(),
          order: String(orderCounter),
          levelName: actionLevelName,
          levelDepth: 3,
          name,
          description: desc,
          assignedTo: owner,
          dueDate,
          parentId: outcomeItemId || strategyItem.id,
          tags,
          members,
          confidence: 100,
        });

        // Handle measurement column
        if (metricVal) {
          if (measurementMode === 'level4') {
            orderCounter++;
            const measLevelName = levels.find(l => l.depth === 4)?.name || 'Measurement';
            const measItem: PlanItem = createEmptyPlanItem({
              id: crypto.randomUUID(),
              order: String(orderCounter),
              levelName: measLevelName,
              levelDepth: 4,
              name: metricVal,
              parentId: actionItem.id,
              confidence: 100,
              tags: sourceSheet ? [`Source: ${sourceSheet}`] : [],
            });
            items.push(actionItem);
            items.push(measItem);
            continue;
          } else {
            actionItem.metricDescription = 'Track to Target';
            actionItem.metricTarget = metricVal;
          }
        }

        items.push(actionItem);
      }
    }
  } else {
    // Generic pattern (original logic)
    const useSectionAsLevel = sectionMapping.type === 'level';
    const sectionDepth = useSectionAsLevel ? sectionMapping.depth : 0;
    const dataDepth = useSectionAsLevel ? sectionDepth + 1 : 1;
    const dataLevelName = levels.find(l => l.depth === dataDepth)?.name || `Level ${dataDepth}`;

    for (const section of sections) {
      let sectionItemId: string | null = null;
      const sourceSheet = getSourceSheet(section);

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
          tags: sourceSheet ? [`Source: ${sourceSheet}`] : [],
        });
        items.push(sectionItem);
        sectionItemId = sectionItem.id;
      }

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

        const tags: string[] = [];
        if (tag) tags.push(tag);
        if (sourceSheet) tags.push(`Source: ${sourceSheet}`);

        const members: string[] = [];
        for (const mc of memberCols) {
          const mv = getColumnValue(row, mc);
          if (mv) members.push(mv);
        }

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
          tags,
          members,
          confidence: 100,
        });

        if (metric) {
          item.metricDescription = 'Track to Target';
          item.metricTarget = metric;
        }

        items.push(item);
      }
    }
  }

  const personMappings: PersonMapping[] = Array.from(personNames).map((name, i) => ({
    id: String(i + 1),
    foundName: name,
    email: '',
    isResolved: false,
  }));

  return { items, personMappings };
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
