import { PlanItem } from '@/types/plan';

export interface FieldChange {
  field: string;
  oldValue: string;
  newValue: string;
}

export interface DiffItem {
  type: 'added' | 'removed' | 'modified' | 'unchanged';
  name: string;
  order: string;
  fields?: FieldChange[];
  item?: PlanItem; // the imported item for added/modified
}

export interface DiffSummary {
  added: DiffItem[];
  removed: DiffItem[];
  modified: DiffItem[];
  unchanged: DiffItem[];
  totalImported: number;
  totalCurrent: number;
}

const COMPARE_FIELDS: (keyof PlanItem)[] = [
  'name', 'levelName', 'description', 'status', 'startDate', 'dueDate',
  'assignedTo', 'updateFrequency', 'metricDescription', 'metricUnit',
  'metricRollup', 'metricBaseline', 'metricTarget', 'currentValue', 'order',
];

const ARRAY_FIELDS: (keyof PlanItem)[] = ['members', 'administrators', 'tags'];

const FIELD_LABELS: Record<string, string> = {
  name: 'Name', levelName: 'Level', description: 'Description', status: 'Status',
  startDate: 'Start Date', dueDate: 'Due Date', assignedTo: 'Assigned To',
  updateFrequency: 'Update Frequency', metricDescription: 'Metric Description',
  metricUnit: 'Metric Unit', metricRollup: 'Metric Rollup', metricBaseline: 'Metric Baseline',
  metricTarget: 'Metric Target', currentValue: 'Current Value', order: 'Order',
  members: 'Members', administrators: 'Administrators', tags: 'Tags',
};

function arrToStr(arr: string[]): string {
  return (arr || []).slice().sort().join(', ');
}

export function calculateDiff(currentItems: PlanItem[], importedItems: PlanItem[]): DiffSummary {
  const result: DiffSummary = {
    added: [], removed: [], modified: [], unchanged: [],
    totalImported: importedItems.length,
    totalCurrent: currentItems.length,
  };

  const matchedCurrentIds = new Set<string>();

  for (const imp of importedItems) {
    // Match by order (primary), then by name (fallback)
    let match = currentItems.find(c => c.order && c.order === imp.order && !matchedCurrentIds.has(c.id));
    if (!match) match = currentItems.find(c => c.name === imp.name && !matchedCurrentIds.has(c.id));

    if (!match) {
      result.added.push({ type: 'added', name: imp.name, order: imp.order, item: imp });
      continue;
    }

    matchedCurrentIds.add(match.id);

    // Compare fields
    const changes: FieldChange[] = [];
    for (const field of COMPARE_FIELDS) {
      const oldVal = String(match[field] ?? '');
      const newVal = String(imp[field] ?? '');
      if (oldVal !== newVal) {
        changes.push({ field: FIELD_LABELS[field] || field, oldValue: oldVal || '—', newValue: newVal || '—' });
      }
    }
    for (const field of ARRAY_FIELDS) {
      const oldVal = arrToStr(match[field] as string[]);
      const newVal = arrToStr(imp[field] as string[]);
      if (oldVal !== newVal) {
        changes.push({ field: FIELD_LABELS[field] || field, oldValue: oldVal || '—', newValue: newVal || '—' });
      }
    }

    if (changes.length > 0) {
      result.modified.push({ type: 'modified', name: imp.name, order: imp.order, fields: changes, item: imp });
    } else {
      result.unchanged.push({ type: 'unchanged', name: imp.name, order: imp.order });
    }
  }

  // Remaining unmatched current items are removed
  for (const cur of currentItems) {
    if (!matchedCurrentIds.has(cur.id)) {
      result.removed.push({ type: 'removed', name: cur.name, order: cur.order });
    }
  }

  return result;
}
