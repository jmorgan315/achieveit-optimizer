import * as XLSX from 'xlsx';
import { PlanItem, PlanLevel } from '@/types/plan';

/**
 * Exports plan items to an xlsx file formatted for AchieveIt import.
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

  const rows = items.map((item) => {
    const row: (string | number)[] = [
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
        item.confidence ?? 100,
        (item.corrections ?? []).join('; '),
      );
    }

    return row;
  });

  const aoa = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Set column widths
  ws['!cols'] = [
    { wch: 8 },   // Order
    { wch: 16 },  // Level
    { wch: 40 },  // Name
    { wch: 50 },  // Description
    { wch: 14 },  // Status
    { wch: 12 },  // Start Date
    { wch: 12 },  // Due Date
    { wch: 28 },  // Assigned To
    { wch: 28 },  // Members
    { wch: 28 },  // Administrators
    { wch: 18 },  // Update Frequency
    { wch: 24 },  // Metric Description
    { wch: 14 },  // Metric Unit
    { wch: 14 },  // Metric Rollup
    { wch: 14 },  // Metric Baseline
    { wch: 14 },  // Metric Target
    { wch: 14 },  // Current Value
    { wch: 20 },  // Tags
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Plan');

  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

  const filename = includeConfidence
    ? 'achieveit-plan-extended-export.xlsx'
    : 'achieveit-plan-import.xlsx';

  const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
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
