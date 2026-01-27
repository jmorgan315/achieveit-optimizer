import { PlanItem, PlanLevel } from '@/types/plan';

/**
 * Exports plan items to a CSV file formatted exactly like the AchieveIt import template.
 * Column order matches: Order, Level, Name, Description, Status, Start Date, Due Date,
 * Assigned To, Members, Administrators, Update Frequency, Metric Description, Metric Unit,
 * Metric Rollup, Metric Baseline, Metric Target, Current Value, Tags
 */
export function exportToExcel(items: PlanItem[], levels: PlanLevel[]): void {
  // AchieveIt template headers - exact match
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

  // Helper to format dates as M/D/YY (matching AchieveIt format)
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

  // Helper to escape CSV values
  const escapeCSV = (value: string): string => {
    if (value === null || value === undefined) return '';
    const stringValue = String(value);
    // If value contains comma, quote, or newline, wrap in quotes
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
  };

  // Convert items to rows matching AchieveIt template structure
  const rows = items.map((item) => {
    return [
      item.order || '',                           // Order
      item.levelName || '',                       // Level
      item.name || '',                            // Name
      item.description || '',                     // Description
      item.status || '',                          // Status
      formatDate(item.startDate),                 // Start Date
      formatDate(item.dueDate),                   // Due Date
      item.assignedTo || '',                      // Assigned To
      item.members?.join(', ') || '',             // Members
      item.administrators?.join(', ') || '',      // Administrators
      item.updateFrequency || '',                 // Update Frequency
      item.metricDescription || '',               // Metric Description
      item.metricUnit || '',                      // Metric Unit
      item.metricRollup || '',                    // Metric Rollup
      item.metricBaseline || '',                  // Metric Baseline
      item.metricTarget || '',                    // Metric Target
      item.currentValue || '',                    // Current Value
      item.tags?.join(',') || '',                 // Tags (comma-separated, no spaces per template)
    ].map(escapeCSV);
  });

  // Build CSV content
  const csvContent = [
    headers.map(escapeCSV).join(','),
    ...rows.map((row) => row.join(',')),
  ].join('\n');

  // Create and download file
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', 'achieveit-plan-import.csv');
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
