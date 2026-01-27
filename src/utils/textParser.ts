import { PlanItem, PlanLevel, PersonMapping, PlanItemStatus, UpdateFrequency, MetricDescription, MetricUnit, MetricRollup } from '@/types/plan';

interface ParsedLine {
  text: string;
  indentLevel: number;
  numbering: string | null;
  labelType: string | null;
}

interface ExtractedData {
  name: string;
  description: string;
  owners: string[];
  startDate: string;
  dueDate: string;
  status: PlanItemStatus;
  metricTarget: string;
  metricUnit: MetricUnit;
  metricDescription: MetricDescription;
  metricBaseline: string;
  currentValue: string;
  updateFrequency: UpdateFrequency;
}

// Patterns for detecting hierarchy
const NUMBERING_PATTERN = /^(\d+(?:\.\d+)*)\s*[.):]*\s*/;
const LABELED_PATTERN = /^(Strategic Priority|Priority|Objective|Initiative|Goal|Task|Milestone|Action Item|KPI|Key Result)\s*(\d+(?:\.\d+)*)?[.:]*\s*/i;

// Owner extraction patterns
const OWNER_PATTERNS = [
  /(?:Owner|Lead|Assigned to|Responsible|Primary Owner|Point Person)[:\s]+([^,\n]+(?:,\s*[^,\n]+)*)/i,
  /(?:Manager|Director|Supervisor)[:\s]+([^,\n]+)/i,
];

// Date patterns
const DATE_PATTERNS = {
  start: [
    /(?:Start|Begin|Kick[- ]?off)[:\s]+([^\n,]+)/i,
    /(?:Starting|From)[:\s]+([^\n,]+)/i,
  ],
  due: [
    /(?:Due|End|Deadline|Target Date|Complete by)[:\s]+([^\n,]+)/i,
    /(?:Ending|By|Until)[:\s]+([^\n,]+)/i,
  ],
};

// Status patterns
const STATUS_PATTERN = /(?:Status)[:\s]+(On Track|At Risk|Off Track|Complete|Not Started|In Progress)/i;

// Metric patterns
const METRIC_PATTERNS = {
  target: [
    /(?:Target|Goal|Objective|KPI)[:\s]+(\$?[\d,.]+%?|\d+\s*(?:downloads|users|partners|integrations|offices)?)/i,
    /(\$[\d,.]+[MKBmkb]?)/i,
    /([\d,.]+%)/,
  ],
  baseline: [
    /(?:Baseline|Starting Value|Current)[:\s]+([\d,.]+%?)/i,
  ],
};

// Quarter to date conversion
function quarterToDate(quarterStr: string, isEnd: boolean = false): string {
  const match = quarterStr.match(/Q([1-4])\s*(\d{4})/i);
  if (!match) return '';
  
  const quarter = parseInt(match[1]);
  const year = match[2];
  
  const startMonths: Record<number, string> = { 1: '01-01', 2: '04-01', 3: '07-01', 4: '10-01' };
  const endMonths: Record<number, string> = { 1: '03-31', 2: '06-30', 3: '09-30', 4: '12-31' };
  
  return `${year}-${isEnd ? endMonths[quarter] : startMonths[quarter]}`;
}

// Parse various date formats
function parseDate(dateStr: string, isEnd: boolean = false): string {
  if (!dateStr) return '';
  
  dateStr = dateStr.trim();
  
  // Quarter format: Q1 2024
  if (/Q[1-4]\s*\d{4}/i.test(dateStr)) {
    return quarterToDate(dateStr, isEnd);
  }
  
  // MM/DD/YYYY or MM-DD-YYYY
  const mdyMatch = dateStr.match(/(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})/);
  if (mdyMatch) {
    const month = mdyMatch[1].padStart(2, '0');
    const day = mdyMatch[2].padStart(2, '0');
    const year = mdyMatch[3].length === 2 ? `20${mdyMatch[3]}` : mdyMatch[3];
    return `${year}-${month}-${day}`;
  }
  
  // YYYY-MM-DD (already ISO)
  const isoMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return dateStr;
  
  return '';
}

// Detect metric unit from value string
function detectMetricUnit(value: string): MetricUnit {
  if (value.includes('%')) return 'Percentage';
  if (value.includes('$') || /\d+[MKBmkb]/.test(value)) return 'Dollar';
  return 'Number';
}

// Clean and extract metric value
function cleanMetricValue(value: string): string {
  return value.replace(/[,$]/g, '').trim();
}

// Extract all data from a text block
function extractData(textBlock: string): ExtractedData {
  const result: ExtractedData = {
    name: '',
    description: '',
    owners: [],
    startDate: '',
    dueDate: '',
    status: '',
    metricTarget: '',
    metricUnit: '',
    metricDescription: '',
    metricBaseline: '',
    currentValue: '',
    updateFrequency: '',
  };
  
  // Extract owners
  for (const pattern of OWNER_PATTERNS) {
    const match = textBlock.match(pattern);
    if (match) {
      const ownerStr = match[1];
      // Split by "and" or ","
      const owners = ownerStr.split(/\s+and\s+|,\s*/).map(o => o.trim()).filter(Boolean);
      result.owners.push(...owners);
    }
  }
  
  // Extract dates
  for (const pattern of DATE_PATTERNS.start) {
    const match = textBlock.match(pattern);
    if (match) {
      result.startDate = parseDate(match[1], false);
      break;
    }
  }
  
  for (const pattern of DATE_PATTERNS.due) {
    const match = textBlock.match(pattern);
    if (match) {
      result.dueDate = parseDate(match[1], true);
      break;
    }
  }
  
  // Extract status
  const statusMatch = textBlock.match(STATUS_PATTERN);
  if (statusMatch) {
    const statusMap: Record<string, PlanItemStatus> = {
      'on track': 'On Track',
      'at risk': 'At Risk',
      'off track': 'Off Track',
      'complete': 'Complete',
      'not started': 'Not Started',
      'in progress': 'On Track',
    };
    result.status = statusMap[statusMatch[1].toLowerCase()] || '';
  }
  
  // Extract metrics
  for (const pattern of METRIC_PATTERNS.target) {
    const match = textBlock.match(pattern);
    if (match) {
      result.metricTarget = cleanMetricValue(match[1]);
      result.metricUnit = detectMetricUnit(match[1]);
      result.metricDescription = 'Track to Target';
      break;
    }
  }
  
  for (const pattern of METRIC_PATTERNS.baseline) {
    const match = textBlock.match(pattern);
    if (match) {
      result.metricBaseline = cleanMetricValue(match[1]);
      break;
    }
  }
  
  // Extract description (lines that don't match other patterns)
  const descMatch = textBlock.match(/(?:Description|Notes|Details)[:\s]+([^\n]+)/i);
  if (descMatch) {
    result.description = descMatch[1].trim();
  }
  
  return result;
}

// Parse a single line to detect hierarchy
function parseLine(line: string): ParsedLine {
  const trimmed = line.trimStart();
  const indentLevel = Math.floor((line.length - trimmed.length) / 2);
  
  let numbering: string | null = null;
  let labelType: string | null = null;
  let text = trimmed;
  
  // Check for numbered items first
  const numMatch = text.match(NUMBERING_PATTERN);
  if (numMatch) {
    numbering = numMatch[1];
    text = text.slice(numMatch[0].length);
  }
  
  // Check for labeled items
  const labelMatch = text.match(LABELED_PATTERN);
  if (labelMatch) {
    labelType = labelMatch[1].toLowerCase();
    if (labelMatch[2] && !numbering) {
      numbering = labelMatch[2];
    }
    text = text.slice(labelMatch[0].length);
  }
  
  return { text: text.trim(), indentLevel, numbering, labelType };
}

// Map label types to level depths
function getLevelFromLabel(labelType: string | null, levels: PlanLevel[]): { depth: number; name: string } {
  if (!labelType) return { depth: 1, name: levels[0]?.name || 'Item' };
  
  const labelMap: Record<string, number> = {
    'strategic priority': 1,
    'priority': 1,
    'milestone': 1,
    'objective': 2,
    'goal': 2,
    'key result': 2,
    'initiative': 3,
    'task': 3,
    'action item': 3,
    'kpi': 3,
  };
  
  const depth = labelMap[labelType] || 1;
  const levelName = levels.find(l => l.depth === depth)?.name || labelType;
  
  return { depth, name: levelName };
}

// Get level from numbering (1.1.1 = depth 3)
function getLevelFromNumbering(numbering: string, levels: PlanLevel[]): { depth: number; name: string } {
  const parts = numbering.split('.');
  const depth = Math.min(parts.length, levels.length || 3);
  const name = levels.find(l => l.depth === depth)?.name || `Level ${depth}`;
  return { depth, name };
}

export interface ParseResult {
  items: PlanItem[];
  personMappings: PersonMapping[];
}

export function parseTextToPlanItems(rawText: string, levels: PlanLevel[]): ParseResult {
  if (!rawText || !rawText.trim()) {
    return { items: [], personMappings: [] };
  }
  
  const lines = rawText.split('\n').filter(line => line.trim());
  const items: PlanItem[] = [];
  const personSet = new Set<string>();
  
  let currentBlock: string[] = [];
  let currentMainLine: ParsedLine | null = null;
  let itemId = 1;
  
  // Track parent stack by depth
  const parentStack: Map<number, string> = new Map();
  
  function processBlock() {
    if (!currentMainLine || !currentMainLine.text) return;
    
    const blockText = currentBlock.join('\n');
    const extracted = extractData(blockText);
    
    // Determine level from numbering or label
    let levelInfo = { depth: 1, name: levels[0]?.name || 'Item' };
    
    if (currentMainLine.numbering) {
      levelInfo = getLevelFromNumbering(currentMainLine.numbering, levels);
    } else if (currentMainLine.labelType) {
      levelInfo = getLevelFromLabel(currentMainLine.labelType, levels);
    } else if (currentMainLine.indentLevel > 0) {
      const depth = Math.min(currentMainLine.indentLevel + 1, levels.length);
      levelInfo = { depth, name: levels.find(l => l.depth === depth)?.name || `Level ${depth}` };
    }
    
    // Find parent
    let parentId: string | null = null;
    for (let d = levelInfo.depth - 1; d >= 1; d--) {
      if (parentStack.has(d)) {
        parentId = parentStack.get(d)!;
        break;
      }
    }
    
    // Add owners to person set
    extracted.owners.forEach(owner => personSet.add(owner));
    
    // Create issues array
    const issues: PlanItem['issues'] = [];
    if (!extracted.owners.length) {
      issues.push({ type: 'missing-owner', message: 'Missing assigned owner email' });
    }
    if (!extracted.startDate || !extracted.dueDate) {
      issues.push({ type: 'missing-dates', message: 'Missing start or due date' });
    }
    
    const item: PlanItem = {
      id: String(itemId),
      order: currentMainLine.numbering || String(itemId),
      levelName: levelInfo.name,
      levelDepth: levelInfo.depth,
      name: currentMainLine.text.replace(/[:\-]+$/, '').trim(),
      description: extracted.description,
      status: extracted.status || 'Not Started',
      startDate: extracted.startDate,
      dueDate: extracted.dueDate,
      assignedTo: extracted.owners[0] || '',
      members: extracted.owners.slice(1),
      administrators: [],
      updateFrequency: extracted.updateFrequency || 'Monthly',
      metricDescription: extracted.metricDescription,
      metricUnit: extracted.metricUnit,
      metricRollup: 'Manual',
      metricBaseline: extracted.metricBaseline,
      metricTarget: extracted.metricTarget,
      currentValue: extracted.currentValue,
      tags: [],
      parentId,
      children: [],
      issues,
    };
    
    items.push(item);
    parentStack.set(levelInfo.depth, String(itemId));
    
    // Clear deeper levels from stack
    for (let d = levelInfo.depth + 1; d <= 10; d++) {
      parentStack.delete(d);
    }
    
    itemId++;
  }
  
  // Process lines
  for (const line of lines) {
    const parsed = parseLine(line);
    
    // Check if this is a new main item (has numbering or label) or just metadata
    const isMainItem = parsed.numbering || parsed.labelType || 
      (parsed.text && !parsed.text.match(/^(Owner|Lead|Start|Due|Target|Status|Description|Baseline)/i));
    
    if (isMainItem && (parsed.numbering || parsed.labelType)) {
      // Process previous block
      if (currentMainLine) {
        processBlock();
      }
      
      currentMainLine = parsed;
      currentBlock = [line];
    } else if (currentMainLine) {
      // Add to current block
      currentBlock.push(line);
    } else {
      // First item without clear hierarchy marker
      currentMainLine = parsed;
      currentBlock = [line];
    }
  }
  
  // Process final block
  if (currentMainLine) {
    processBlock();
  }
  
  // Recalculate order strings based on hierarchy
  const recalculatedItems = recalculateOrders(items);
  
  // Create person mappings
  const personMappings: PersonMapping[] = Array.from(personSet).map((name, idx) => ({
    id: String(idx + 1),
    foundName: name,
    email: '',
    isResolved: false,
  }));
  
  return { items: recalculatedItems, personMappings };
}

function recalculateOrders(items: PlanItem[]): PlanItem[] {
  const result: PlanItem[] = [];
  
  function processLevel(parentId: string | null, prefix: string) {
    const children = items.filter((i) => i.parentId === parentId);
    children.forEach((child, index) => {
      const order = prefix ? `${prefix}.${index + 1}` : `${index + 1}`;
      result.push({ ...child, order });
      processLevel(child.id, order);
    });
  }
  
  processLevel(null, '');
  return result;
}
