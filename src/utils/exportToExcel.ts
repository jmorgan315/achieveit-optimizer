import { PlanItem, PlanLevel } from '@/types/plan';

export function exportToExcel(items: PlanItem[], levels: PlanLevel[]) {
  // Prepare CSV content
  const headers = [
    'Order',
    'Level',
    'Name',
    'Description',
    'Assigned To',
    'Members',
    'Start Date',
    'Due Date',
    'Metric Name',
    'Metric Target',
    'Metric Data Type',
  ];

  const rows = items.map((item) => [
    item.order,
    item.levelName,
    item.name,
    item.description,
    item.assignedTo,
    item.members.join(', '),
    item.startDate,
    item.dueDate,
    item.metricName,
    item.metricTarget,
    item.metricDataType,
  ]);

  // Convert to CSV string
  const csvContent = [
    headers.join(','),
    ...rows.map((row) =>
      row.map((cell) => {
        // Escape quotes and wrap in quotes if contains comma
        const escaped = String(cell).replace(/"/g, '""');
        return escaped.includes(',') || escaped.includes('"') || escaped.includes('\n')
          ? `"${escaped}"`
          : escaped;
      }).join(',')
    ),
  ].join('\n');

  // Create and download file
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', `achieveit-import-${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
