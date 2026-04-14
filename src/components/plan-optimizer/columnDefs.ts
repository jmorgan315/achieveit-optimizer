import { DropdownOption } from './EditableCell';

export interface ColumnDef {
  key: string;
  label: string;
  group: 'core' | 'dates' | 'people' | 'metrics' | 'other';
  defaultVisible: boolean;
  alwaysVisible?: boolean;
  defaultWidth: number;
  editType: 'text' | 'textarea' | 'dropdown' | 'date' | 'readonly';
  options?: DropdownOption[];
  placeholder?: string;
  /** Field name on PlanItem (defaults to key) */
  field?: string;
  /** If true, column uses 1fr and cannot be resized */
  flex?: boolean;
}

export const STATUS_OPTIONS: DropdownOption[] = [
  { value: 'On Track', label: 'On Track' },
  { value: 'At Risk', label: 'At Risk' },
  { value: 'Off Track', label: 'Off Track' },
  { value: 'Complete', label: 'Complete' },
  { value: 'Not Started', label: 'Not Started' },
];

export const UPDATE_FREQUENCY_OPTIONS: DropdownOption[] = [
  { value: 'Weekly', label: 'Weekly' },
  { value: 'Monthly', label: 'Monthly' },
  { value: 'Quarterly', label: 'Quarterly' },
  { value: 'Not Required', label: 'Not Required' },
];

export const METRIC_DESCRIPTION_OPTIONS: DropdownOption[] = [
  { value: 'Track to Target', label: 'Track to Target' },
  { value: 'Maintain', label: 'Maintain' },
  { value: 'Stay Above', label: 'Stay Above' },
  { value: 'Stay Below', label: 'Stay Below' },
];

export const METRIC_UNIT_OPTIONS: DropdownOption[] = [
  { value: 'Number', label: 'Number' },
  { value: 'Dollar', label: 'Dollar' },
  { value: 'Percentage', label: 'Percentage' },
];

export const METRIC_ROLLUP_OPTIONS: DropdownOption[] = [
  { value: 'Manual', label: 'Manual' },
  { value: 'Sum Children', label: 'Sum Children' },
  { value: 'Average Children', label: 'Average Children' },
];

export const ALL_COLUMNS: ColumnDef[] = [
  // Core
  { key: 'order', label: '#', group: 'core', defaultVisible: true, alwaysVisible: true, defaultWidth: 60, editType: 'readonly' },
  { key: 'level', label: 'Level', group: 'core', defaultVisible: true, defaultWidth: 110, editType: 'dropdown' },
  { key: 'name', label: 'Name', group: 'core', defaultVisible: true, alwaysVisible: true, defaultWidth: 0, editType: 'textarea', flex: true },
  { key: 'description', label: 'Description', group: 'core', defaultVisible: false, defaultWidth: 200, editType: 'textarea', placeholder: 'Add description...' },
  { key: 'status', label: 'Status', group: 'core', defaultVisible: false, defaultWidth: 120, editType: 'dropdown', options: STATUS_OPTIONS, placeholder: '—' },

  // Dates
  { key: 'startDate', label: 'Start Date', group: 'dates', defaultVisible: true, defaultWidth: 110, editType: 'date' },
  { key: 'dueDate', label: 'Due Date', group: 'dates', defaultVisible: true, defaultWidth: 110, editType: 'date' },

  // People
  { key: 'assignedTo', label: 'Assigned To', group: 'people', defaultVisible: true, defaultWidth: 160, editType: 'text', placeholder: '—' },
  { key: 'members', label: 'Members', group: 'people', defaultVisible: false, defaultWidth: 160, editType: 'text', placeholder: 'emails...' },
  { key: 'administrators', label: 'Administrators', group: 'people', defaultVisible: false, defaultWidth: 160, editType: 'text', placeholder: 'emails...' },

  // Metrics
  { key: 'metricDescription', label: 'Metric Description', group: 'metrics', defaultVisible: false, defaultWidth: 140, editType: 'dropdown', options: METRIC_DESCRIPTION_OPTIONS, placeholder: '—' },
  { key: 'metricUnit', label: 'Metric Unit', group: 'metrics', defaultVisible: false, defaultWidth: 100, editType: 'dropdown', options: METRIC_UNIT_OPTIONS, placeholder: '—' },
  { key: 'metricRollup', label: 'Metric Rollup', group: 'metrics', defaultVisible: false, defaultWidth: 130, editType: 'dropdown', options: METRIC_ROLLUP_OPTIONS, placeholder: '—' },
  { key: 'metricBaseline', label: 'Metric Baseline', group: 'metrics', defaultVisible: false, defaultWidth: 110, editType: 'text', placeholder: '—' },
  { key: 'metricTarget', label: 'Metric Target', group: 'metrics', defaultVisible: false, defaultWidth: 110, editType: 'text', placeholder: '—' },
  { key: 'currentValue', label: 'Current Value', group: 'metrics', defaultVisible: false, defaultWidth: 110, editType: 'text', placeholder: '—' },

  // Other
  { key: 'updateFrequency', label: 'Update Frequency', group: 'other', defaultVisible: false, defaultWidth: 130, editType: 'dropdown', options: UPDATE_FREQUENCY_OPTIONS, placeholder: '—' },
  { key: 'tags', label: 'Tags', group: 'other', defaultVisible: false, defaultWidth: 140, editType: 'text', placeholder: 'tag1, tag2...' },
];

export const DEFAULT_VISIBLE_COLUMNS = new Set(
  ALL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key)
);

export const COLUMN_GROUPS = [
  { key: 'core', label: 'Core' },
  { key: 'dates', label: 'Dates' },
  { key: 'people', label: 'People' },
  { key: 'metrics', label: 'Metrics' },
  { key: 'other', label: 'Other' },
] as const;
