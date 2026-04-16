import * as XLSX from 'xlsx';
import { PlanItem, PlanItemStatus, UpdateFrequency, MetricDescription, MetricUnit, MetricRollup } from '@/types/plan';

const VALID_STATUSES: PlanItemStatus[] = ['On Track', 'At Risk', 'Off Track', 'Complete', 'Not Started', 'Achieved', 'Not Achieved', 'Cancelled', ''];
const VALID_FREQUENCIES: UpdateFrequency[] = ['Weekly', 'Monthly', 'Quarterly', 'Not Required', 'Daily', 'Biweekly', ''];
const VALID_METRIC_DESC: MetricDescription[] = ['Track to Target', 'Maintain', 'Stay Above', 'Stay Below', ''];
const VALID_METRIC_UNIT: MetricUnit[] = ['Number', 'Dollar', 'Percentage', ''];
const VALID_METRIC_ROLLUP: MetricRollup[] = ['Manual', 'Sum Children', 'Average Children', ''];

function validateEnum<T extends string>(value: string, valid: T[], warnings: string[], row: number, field: string): T {
  const trimmed = value.trim() as T;
  if (valid.includes(trimmed)) return trimmed;
  if (trimmed) warnings.push(`Row ${row}: Invalid ${field} "${trimmed}" — defaulting to empty`);
  return '' as T;
}

function parseDateMDYY(value: unknown): string {
  if (value == null || value === '') return '';
  if (typeof value === 'number') {
    // Excel serial date
    const d = new Date(Math.round((value - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (!s) return '';
  // Try M/D/YY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? (parseInt(m[3]) < 50 ? `20${m[3]}` : `19${m[3]}`) : m[3];
    const d = new Date(`${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }
  // Fallback: try native parse
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function splitComma(value: unknown): string[] {
  if (value == null || value === '') return [];
  return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

export interface ReimportResult {
  items: PlanItem[];
  warnings: string[];
}

export function parseReimportFile(file: ArrayBuffer): ReimportResult {
  const wb = XLSX.read(file, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('The file contains no sheets.');

  const sheet = wb.Sheets[sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (rows.length < 2) throw new Error('The file appears to be empty. Please check your file and try again.');

  // Validate header
  const header = (rows[0] as string[]).map(h => String(h).trim());
  const expectedStart = ['Order', 'Level', 'Name'];
  const headerMatch = expectedStart.every((h, i) => header[i]?.toLowerCase() === h.toLowerCase());
  if (!headerMatch) {
    throw new Error("This doesn't look like a valid export file. Make sure the first sheet has the 18-column template format.");
  }

  const warnings: string[] = [];
  const flatItems: PlanItem[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    const name = String(row[2] ?? '').trim();
    if (!name) continue; // skip empty rows

    const order = String(row[0] ?? '').trim();
    const levelName = String(row[1] ?? '').trim();
    const rowNum = r + 1;

    const item: PlanItem = {
      id: crypto.randomUUID(),
      order,
      levelName,
      levelDepth: order ? order.split('.').length : 1,
      name,
      description: String(row[3] ?? '').trim(),
      status: validateEnum(String(row[4] ?? ''), VALID_STATUSES, warnings, rowNum, 'Status'),
      startDate: parseDateMDYY(row[5]),
      dueDate: parseDateMDYY(row[6]),
      assignedTo: String(row[7] ?? '').trim(),
      members: splitComma(row[8]),
      administrators: splitComma(row[9]),
      updateFrequency: validateEnum(String(row[10] ?? ''), VALID_FREQUENCIES, warnings, rowNum, 'Update Frequency'),
      metricDescription: validateEnum(String(row[11] ?? ''), VALID_METRIC_DESC, warnings, rowNum, 'Metric Description'),
      metricUnit: validateEnum(String(row[12] ?? ''), VALID_METRIC_UNIT, warnings, rowNum, 'Metric Unit'),
      metricRollup: validateEnum(String(row[13] ?? ''), VALID_METRIC_ROLLUP, warnings, rowNum, 'Metric Rollup'),
      metricBaseline: String(row[14] ?? '').trim(),
      metricTarget: String(row[15] ?? '').trim(),
      currentValue: String(row[16] ?? '').trim(),
      tags: splitComma(row[17]),
      parentId: null,
      children: [],
      issues: [],
    };

    flatItems.push(item);
  }

  if (flatItems.length === 0) {
    throw new Error('No rows parsed. The file appears to be empty. Please check your file and try again.');
  }

  // Build parent-child from Order column
  const orderMap = new Map<string, string>(); // order → id
  for (const item of flatItems) {
    if (item.order) orderMap.set(item.order, item.id);
  }

  for (const item of flatItems) {
    if (!item.order || !item.order.includes('.')) continue;
    const parts = item.order.split('.');
    parts.pop();
    const parentOrder = parts.join('.');
    const parentId = orderMap.get(parentOrder);
    if (parentId) item.parentId = parentId;
  }

  return { items: flatItems, warnings };
}
