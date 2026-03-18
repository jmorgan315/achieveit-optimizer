import { PlanItem, PlanLevel } from '@/types/plan';

/**
 * Exports plan items to a CSV file formatted for AchieveIt import.
 * Optionally includes confidence score and corrections columns (extended format).
 */
export function exportToExcel(items: PlanItem[], levels: PlanLevel[], includeConfidence: boolean = false): void {
  const headers = [
    'Order',
    'Level',
    'Name',
    'Description',
    'Status',
    'Start Date',
    'Due Date',
    'Assigned To',
    'Members',
    'Administrators',
    'Update Frequency',
    'Metric Description',
    'Metric Unit',
    'Metric Rollup',
    'Metric Baseline',
    'Metric Target',
    'Current Value',
    'Tags',
  ];

  if (includeConfidence) {
    headers.push('Confidence Score', 'Corrections');
  }

  const formatDate = (dateStr: string): string => {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const year = String(date.getFullYear()).slice(-2);
      return `${month}/${day}/${year}`;
    } catch {
      return dateStr;
    }
  };

  const escapeCSV = (value: string): string => {
    if (value === null || value === undefined) return '';
    const stringValue = String(value);
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
  };

  const rows = items.map((item) => {
    const row = [
      item.order || '',
      item.levelName || '',
      item.name || '',
      item.description || '',
      item.status || '',
      formatDate(item.startDate),
      formatDate(item.dueDate),
      item.assignedTo || '',
      item.members?.join(', ') || '',
      item.administrators?.join(', ') || '',
      item.updateFrequency || '',
      item.metricDescription || '',
      item.metricUnit || '',
      item.metricRollup || '',
      item.metricBaseline || '',
      item.metricTarget || '',
      item.currentValue || '',
      item.tags?.join(',') || '',
    ];

    if (includeConfidence) {
      row.push(
        String(item.confidence ?? 100),
        (item.corrections ?? []).join('; '),
      );
    }

    return row.map(escapeCSV);
  });

  const csvContent = [
    headers.map(escapeCSV).join(','),
    ...rows.map((row) => row.join(',')),
  ].join('\n');

  const filename = includeConfidence
    ? 'achieveit-plan-extended-export.csv'
    : 'achieveit-plan-import.csv';

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
