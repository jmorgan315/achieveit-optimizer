export interface PlanLevel {
  id: string;
  name: string;
  depth: number;
}

export interface PersonMapping {
  id: string;
  foundName: string;
  email: string;
  isResolved: boolean;
}

// Status options matching AchieveIt template
export type PlanItemStatus = 'On Track' | 'At Risk' | 'Off Track' | 'Complete' | 'Not Started' | '';

// Update frequency options matching AchieveIt template
export type UpdateFrequency = 'Weekly' | 'Monthly' | 'Quarterly' | 'Not Required' | '';

// Metric description types matching AchieveIt template
export type MetricDescription = 'Track to Target' | 'Maintain' | 'Stay Above' | 'Stay Below' | '';

// Metric unit types matching AchieveIt template
export type MetricUnit = 'Number' | 'Dollar' | 'Percentage' | '';

// Metric rollup types matching AchieveIt template
export type MetricRollup = 'Manual' | 'Sum Children' | 'Average Children' | '';

export interface PlanItem {
  id: string;
  order: string;
  levelName: string;
  levelDepth: number;
  name: string;
  description: string;
  status: PlanItemStatus;
  startDate: string;
  dueDate: string;
  assignedTo: string;
  members: string[];
  administrators: string[];
  updateFrequency: UpdateFrequency;
  metricDescription: MetricDescription;
  metricUnit: MetricUnit;
  metricRollup: MetricRollup;
  metricBaseline: string;
  metricTarget: string;
  currentValue: string;
  tags: string[];
  parentId: string | null;
  children: PlanItem[];
  issues: PlanItemIssue[];
  confidence?: number;
  corrections?: string[];
}

export interface PlanItemIssue {
  type: 'missing-owner' | 'missing-dates' | 'orphan' | 'missing-metric';
  message: string;
}

export interface OrgProfile {
  organizationName: string;
  industry: string;
  website?: string;
  summary?: string;
  documentHints?: string;
  planLevels?: Array<{ depth: number; name: string }>;
  pageRange?: string;
  confirmed: boolean;
}

export interface PlanState {
  levels: PlanLevel[];
  items: PlanItem[];
  personMappings: PersonMapping[];
  rawText: string;
  orgProfile?: OrgProfile;
  sessionId?: string;
}

export interface DedupRemovedDetail {
  removed_name: string;
  removed_page: number;
  removed_parent: string;
  removed_item: Record<string, unknown>;
  removed_sibling_index?: number;
  kept_name: string;
  kept_page: number;
  kept_parent: string;
  match_reason: string;
}

export const DEFAULT_LEVELS: PlanLevel[] = [
  { id: '1', name: 'Strategic Priority', depth: 1 },
  { id: '2', name: 'Objective', depth: 2 },
  { id: '3', name: 'Goal', depth: 3 },
  { id: '4', name: 'Strategy', depth: 4 },
  { id: '5', name: 'KPI', depth: 5 },
];

export const SAMPLE_RAW_TEXT = `
Strategic Priority 1: Digital Transformation
Owner: John Smith, IT Department
Status: On Track

Objective 1.1: Modernize Core Systems
Owner: Sarah Johnson
Start: Q1 2024, Due: Q4 2024
Description: Replace legacy systems with cloud-based solutions

Initiative 1.1.1: Cloud Migration
Owner: Mike Chen and Lisa Wang
Target: 80% migration
Description: Migrate all on-premise servers to AWS

Initiative 1.1.2: API Integration
Owner: Development Team
Target: 50 integrations
Description: Build REST APIs for all core services

Objective 1.2: Enhance Customer Experience
Owner: Emily Davis
Start: Q2 2024, Due: Q4 2024

Initiative 1.2.1: Mobile App Launch
Owner: Product Team
Target: 100,000 downloads
Description: Launch iOS and Android apps

Strategic Priority 2: Revenue Growth
Owner: Bob Williams, Sales Department

Objective 2.1: Expand Market Share
Owner: Alex Thompson
Start: Q1 2024, Due: Q4 2024

Initiative 2.1.1: New Sales Channels
Owner: Chris Martin
Target: $2M revenue
Description: Open 3 new regional offices

Initiative 2.1.2: Partnership Program
Owner: Jessica Brown and Tom Wilson
Target: 25 partners
Description: Establish strategic partnerships
`;

export function generateMockPlanItems(levels: PlanLevel[]): { items: PlanItem[], personMappings: PersonMapping[] } {
  const personMappings: PersonMapping[] = [
    { id: '1', foundName: 'John Smith', email: '', isResolved: false },
    { id: '2', foundName: 'IT Department', email: '', isResolved: false },
    { id: '3', foundName: 'Sarah Johnson', email: '', isResolved: false },
    { id: '4', foundName: 'Mike Chen', email: '', isResolved: false },
    { id: '5', foundName: 'Lisa Wang', email: '', isResolved: false },
    { id: '6', foundName: 'Development Team', email: '', isResolved: false },
    { id: '7', foundName: 'Emily Davis', email: '', isResolved: false },
    { id: '8', foundName: 'Product Team', email: '', isResolved: false },
    { id: '9', foundName: 'Bob Williams', email: '', isResolved: false },
    { id: '10', foundName: 'Sales Department', email: '', isResolved: false },
    { id: '11', foundName: 'Alex Thompson', email: '', isResolved: false },
    { id: '12', foundName: 'Chris Martin', email: '', isResolved: false },
    { id: '13', foundName: 'Jessica Brown', email: '', isResolved: false },
    { id: '14', foundName: 'Tom Wilson', email: '', isResolved: false },
  ];

  const level1 = levels[0]?.name || 'Milestone';
  const level2 = levels[1]?.name || 'Goal';
  const level3 = levels[2]?.name || 'Task';

  const createDefaultItem = (overrides: Partial<PlanItem>): PlanItem => ({
    id: '',
    order: '',
    levelName: level1,
    levelDepth: 1,
    name: '',
    description: '',
    status: 'On Track',
    startDate: '',
    dueDate: '',
    assignedTo: '',
    members: [],
    administrators: [],
    updateFrequency: 'Monthly',
    metricDescription: '',
    metricUnit: '',
    metricRollup: 'Manual',
    metricBaseline: '',
    metricTarget: '',
    currentValue: '',
    tags: [],
    parentId: null,
    children: [],
    issues: [],
    ...overrides,
  });

  const items: PlanItem[] = [
    createDefaultItem({
      id: '1',
      order: '1',
      levelName: level1,
      levelDepth: 1,
      name: 'Digital Transformation',
      description: 'Lead the organization through comprehensive digital transformation',
      status: 'On Track',
      startDate: '2024-01-01',
      dueDate: '2024-12-31',
      updateFrequency: 'Weekly',
      administrators: [],
      issues: [{ type: 'missing-owner', message: 'Missing assigned owner email' }],
    }),
    createDefaultItem({
      id: '2',
      order: '1.1',
      levelName: level2,
      levelDepth: 2,
      name: 'Modernize Core Systems',
      description: 'Replace legacy systems with cloud-based solutions',
      status: 'On Track',
      startDate: '2024-01-01',
      dueDate: '2024-12-31',
      parentId: '1',
      updateFrequency: 'Monthly',
      metricDescription: 'Track to Target',
      metricUnit: 'Number',
      metricRollup: 'Sum Children',
      metricBaseline: '0',
      metricTarget: '100',
      tags: ['priority-1'],
      issues: [{ type: 'missing-owner', message: 'Missing assigned owner email' }],
    }),
    createDefaultItem({
      id: '3',
      order: '1.1.1',
      levelName: level3,
      levelDepth: 3,
      name: 'Cloud Migration',
      description: 'Migrate all on-premise servers to AWS',
      status: 'On Track',
      parentId: '2',
      updateFrequency: 'Quarterly',
      metricDescription: 'Track to Target',
      metricUnit: 'Percentage',
      metricRollup: 'Manual',
      metricBaseline: '0%',
      metricTarget: '80%',
      currentValue: '25%',
      tags: ['priority-2'],
      issues: [
        { type: 'missing-owner', message: 'Missing assigned owner email' },
        { type: 'missing-dates', message: 'Missing start or due date' },
      ],
    }),
    createDefaultItem({
      id: '4',
      order: '1.1.2',
      levelName: level3,
      levelDepth: 3,
      name: 'API Integration',
      description: 'Build REST APIs for all core services',
      status: 'On Track',
      parentId: '2',
      updateFrequency: 'Not Required',
      metricDescription: 'Track to Target',
      metricUnit: 'Number',
      metricRollup: 'Manual',
      metricBaseline: '0',
      metricTarget: '50',
      currentValue: '12',
      tags: ['priority-1', 'focus-area'],
      issues: [
        { type: 'missing-owner', message: 'Missing assigned owner email' },
        { type: 'missing-dates', message: 'Missing start or due date' },
      ],
    }),
    createDefaultItem({
      id: '5',
      order: '1.2',
      levelName: level2,
      levelDepth: 2,
      name: 'Enhance Customer Experience',
      description: 'Improve all customer touchpoints and satisfaction metrics',
      status: 'On Track',
      startDate: '2024-04-01',
      dueDate: '2024-12-31',
      parentId: '1',
      updateFrequency: 'Monthly',
      issues: [{ type: 'missing-owner', message: 'Missing assigned owner email' }],
    }),
    createDefaultItem({
      id: '6',
      order: '1.2.1',
      levelName: level3,
      levelDepth: 3,
      name: 'Mobile App Launch',
      description: 'Launch iOS and Android apps',
      status: 'On Track',
      parentId: '5',
      updateFrequency: 'Not Required',
      metricDescription: 'Track to Target',
      metricUnit: 'Number',
      metricRollup: 'Manual',
      metricBaseline: '0',
      metricTarget: '100000',
      currentValue: '0',
      issues: [
        { type: 'missing-owner', message: 'Missing assigned owner email' },
        { type: 'missing-dates', message: 'Missing start or due date' },
      ],
    }),
    createDefaultItem({
      id: '7',
      order: '2',
      levelName: level1,
      levelDepth: 1,
      name: 'Revenue Growth',
      description: 'Drive sustainable revenue growth through market expansion',
      status: 'On Track',
      updateFrequency: 'Not Required',
      metricDescription: 'Track to Target',
      metricUnit: 'Dollar',
      metricRollup: 'Manual',
      metricBaseline: '$0',
      metricTarget: '$50,000',
      currentValue: '$0',
      issues: [{ type: 'missing-owner', message: 'Missing assigned owner email' }],
    }),
    createDefaultItem({
      id: '8',
      order: '2.1',
      levelName: level2,
      levelDepth: 2,
      name: 'Expand Market Share',
      description: 'Increase market presence in key regions',
      status: 'On Track',
      startDate: '2024-08-01',
      dueDate: '2024-08-31',
      parentId: '7',
      updateFrequency: 'Monthly',
      metricDescription: 'Track to Target',
      metricUnit: 'Percentage',
      metricRollup: 'Manual',
      metricBaseline: '0%',
      metricTarget: '100%',
      currentValue: '0%',
      issues: [{ type: 'missing-owner', message: 'Missing assigned owner email' }],
    }),
    createDefaultItem({
      id: '9',
      order: '2.1.1',
      levelName: level3,
      levelDepth: 3,
      name: 'New Sales Channels',
      description: 'Open 3 new regional offices',
      status: 'At Risk',
      parentId: '8',
      updateFrequency: 'Not Required',
      metricDescription: 'Stay Below',
      metricUnit: 'Number',
      metricRollup: 'Manual',
      metricTarget: '50',
      currentValue: '45',
      issues: [
        { type: 'missing-owner', message: 'Missing assigned owner email' },
        { type: 'missing-dates', message: 'Missing start or due date' },
      ],
    }),
    createDefaultItem({
      id: '10',
      order: '2.1.2',
      levelName: level3,
      levelDepth: 3,
      name: 'Partnership Program',
      description: 'Establish strategic partnerships',
      status: 'Off Track',
      parentId: '8',
      updateFrequency: 'Not Required',
      metricDescription: 'Maintain',
      metricUnit: 'Number',
      metricRollup: 'Manual',
      metricBaseline: '10',
      metricTarget: '25',
      currentValue: '11',
      issues: [
        { type: 'missing-owner', message: 'Missing assigned owner email' },
        { type: 'missing-dates', message: 'Missing start or due date' },
      ],
    }),
  ];

  return { items, personMappings };
}
