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

export interface PlanItem {
  id: string;
  order: string;
  levelName: string;
  levelDepth: number;
  name: string;
  description: string;
  assignedTo: string;
  members: string[];
  startDate: string;
  dueDate: string;
  metricName: string;
  metricTarget: string;
  metricDataType: 'Currency' | 'Number' | 'Percentage' | '';
  parentId: string | null;
  children: PlanItem[];
  issues: PlanItemIssue[];
}

export interface PlanItemIssue {
  type: 'missing-owner' | 'missing-dates' | 'orphan' | 'missing-metric';
  message: string;
}

export type ProcessingPath = 'direct' | 'optimizer' | null;

export interface PlanState {
  levels: PlanLevel[];
  items: PlanItem[];
  personMappings: PersonMapping[];
  processingPath: ProcessingPath;
  rawText: string;
}

export const DEFAULT_LEVELS: PlanLevel[] = [
  { id: '1', name: 'Focus Area', depth: 1 },
  { id: '2', name: 'Initiative', depth: 2 },
  { id: '3', name: 'Goal', depth: 3 },
];

export const SAMPLE_RAW_TEXT = `
Strategic Priority 1: Digital Transformation
Owner: John Smith, IT Department

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

  const level1 = levels[0]?.name || 'Focus Area';
  const level2 = levels[1]?.name || 'Initiative';
  const level3 = levels[2]?.name || 'Goal';

  const items: PlanItem[] = [
    {
      id: '1',
      order: '1',
      levelName: level1,
      levelDepth: 1,
      name: 'Digital Transformation',
      description: 'Lead the organization through comprehensive digital transformation',
      assignedTo: '',
      members: [],
      startDate: '',
      dueDate: '',
      metricName: '',
      metricTarget: '',
      metricDataType: '',
      parentId: null,
      children: [],
      issues: [{ type: 'missing-owner', message: 'Missing assigned owner email' }],
    },
    {
      id: '2',
      order: '1.1',
      levelName: level2,
      levelDepth: 2,
      name: 'Modernize Core Systems',
      description: 'Replace legacy systems with cloud-based solutions',
      assignedTo: '',
      members: [],
      startDate: '2024-01-01',
      dueDate: '2024-12-31',
      metricName: '',
      metricTarget: '',
      metricDataType: '',
      parentId: '1',
      children: [],
      issues: [{ type: 'missing-owner', message: 'Missing assigned owner email' }],
    },
    {
      id: '3',
      order: '1.1.1',
      levelName: level3,
      levelDepth: 3,
      name: 'Cloud Migration',
      description: 'Migrate all on-premise servers to AWS',
      assignedTo: '',
      members: [],
      startDate: '',
      dueDate: '',
      metricName: 'Migration Percentage',
      metricTarget: '80',
      metricDataType: 'Percentage',
      parentId: '2',
      children: [],
      issues: [
        { type: 'missing-owner', message: 'Missing assigned owner email' },
        { type: 'missing-dates', message: 'Missing start or due date' },
      ],
    },
    {
      id: '4',
      order: '1.1.2',
      levelName: level3,
      levelDepth: 3,
      name: 'API Integration',
      description: 'Build REST APIs for all core services',
      assignedTo: '',
      members: [],
      startDate: '',
      dueDate: '',
      metricName: 'Integrations',
      metricTarget: '50',
      metricDataType: 'Number',
      parentId: '2',
      children: [],
      issues: [
        { type: 'missing-owner', message: 'Missing assigned owner email' },
        { type: 'missing-dates', message: 'Missing start or due date' },
      ],
    },
    {
      id: '5',
      order: '1.2',
      levelName: level2,
      levelDepth: 2,
      name: 'Enhance Customer Experience',
      description: 'Improve all customer touchpoints and satisfaction metrics',
      assignedTo: '',
      members: [],
      startDate: '2024-04-01',
      dueDate: '2024-12-31',
      metricName: '',
      metricTarget: '',
      metricDataType: '',
      parentId: '1',
      children: [],
      issues: [{ type: 'missing-owner', message: 'Missing assigned owner email' }],
    },
    {
      id: '6',
      order: '1.2.1',
      levelName: level3,
      levelDepth: 3,
      name: 'Mobile App Launch',
      description: 'Launch iOS and Android apps',
      assignedTo: '',
      members: [],
      startDate: '',
      dueDate: '',
      metricName: 'Downloads',
      metricTarget: '100000',
      metricDataType: 'Number',
      parentId: '5',
      children: [],
      issues: [
        { type: 'missing-owner', message: 'Missing assigned owner email' },
        { type: 'missing-dates', message: 'Missing start or due date' },
      ],
    },
    {
      id: '7',
      order: '2',
      levelName: level1,
      levelDepth: 1,
      name: 'Revenue Growth',
      description: 'Drive sustainable revenue growth through market expansion',
      assignedTo: '',
      members: [],
      startDate: '',
      dueDate: '',
      metricName: '',
      metricTarget: '',
      metricDataType: '',
      parentId: null,
      children: [],
      issues: [{ type: 'missing-owner', message: 'Missing assigned owner email' }],
    },
    {
      id: '8',
      order: '2.1',
      levelName: level2,
      levelDepth: 2,
      name: 'Expand Market Share',
      description: 'Increase market presence in key regions',
      assignedTo: '',
      members: [],
      startDate: '2024-01-01',
      dueDate: '2024-12-31',
      metricName: '',
      metricTarget: '',
      metricDataType: '',
      parentId: '7',
      children: [],
      issues: [{ type: 'missing-owner', message: 'Missing assigned owner email' }],
    },
    {
      id: '9',
      order: '2.1.1',
      levelName: level3,
      levelDepth: 3,
      name: 'New Sales Channels',
      description: 'Open 3 new regional offices',
      assignedTo: '',
      members: [],
      startDate: '',
      dueDate: '',
      metricName: 'Revenue',
      metricTarget: '2000000',
      metricDataType: 'Currency',
      parentId: '8',
      children: [],
      issues: [
        { type: 'missing-owner', message: 'Missing assigned owner email' },
        { type: 'missing-dates', message: 'Missing start or due date' },
      ],
    },
    {
      id: '10',
      order: '2.1.2',
      levelName: level3,
      levelDepth: 3,
      name: 'Partnership Program',
      description: 'Establish strategic partnerships',
      assignedTo: '',
      members: [],
      startDate: '',
      dueDate: '',
      metricName: 'Partners',
      metricTarget: '25',
      metricDataType: 'Number',
      parentId: '8',
      children: [],
      issues: [
        { type: 'missing-owner', message: 'Missing assigned owner email' },
        { type: 'missing-dates', message: 'Missing start or due date' },
      ],
    },
  ];

  return { items, personMappings };
}
