import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { CheckCircle2, Info, Sparkles, AlertTriangle } from 'lucide-react';
import {
  SheetDetection,
  ColumnRole,
  ElementRole,
  MappingConfig,
  MeasurementMode,
  generatePlanItems,
} from '@/utils/spreadsheet-parser';
import { PlanLevel } from '@/types/plan';

export type LevelChoice = 'user' | 'classifier' | 'reconfigure';

interface LevelConflictBlockProps {
  sheetName?: string;
  userLevels: string[];
  classifierLevels: string[];
  onApply: (choice: LevelChoice) => void;
  busy?: boolean;
}

export function LevelConflictBlock({
  sheetName,
  userLevels,
  classifierLevels,
  onApply,
  busy,
}: LevelConflictBlockProps) {
  const [choice, setChoice] = useState<LevelChoice>('user');
  return (
    <Card className="border-primary/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          AI Analysis
          {sheetName && (
            <Badge variant="outline" className="font-normal ml-1">{sheetName}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm">
          <div className="font-medium mb-1">
            You said this plan uses {userLevels.length} level{userLevels.length === 1 ? '' : 's'}:
          </div>
          <div className="text-muted-foreground pl-2">{userLevels.join(' → ')}</div>
        </div>
        <div className="text-sm">
          <div className="font-medium mb-1">
            The AI detected {classifierLevels.length} level{classifierLevels.length === 1 ? '' : 's'} in this sheet:
          </div>
          <div className="text-muted-foreground pl-2">{classifierLevels.join(' → ')}</div>
        </div>
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Mismatch detected. Which is correct?</AlertTitle>
          <AlertDescription>
            <RadioGroup
              value={choice}
              onValueChange={(v) => setChoice(v as LevelChoice)}
              className="mt-3 space-y-2"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="user" id="lvl-user" />
                <Label htmlFor="lvl-user" className="cursor-pointer font-normal">
                  Use my {userLevels.length} levels (default)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="classifier" id="lvl-cls" />
                <Label htmlFor="lvl-cls" className="cursor-pointer font-normal">
                  Use AI's {classifierLevels.length} levels
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="reconfigure" id="lvl-rec" />
                <Label htmlFor="lvl-rec" className="cursor-pointer font-normal">
                  Let me reconfigure
                </Label>
              </div>
            </RadioGroup>
          </AlertDescription>
        </Alert>
        <div className="flex justify-end">
          <Button onClick={() => onApply(choice)} disabled={busy}>
            {busy ? 'Applying…' : 'Apply'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}


interface MappingInterfaceProps {
  sheetDetection: SheetDetection;
  levels: PlanLevel[];
  onApply: (config: MappingConfig) => void;
  columnMappings: Record<string, ColumnRole>;
  setColumnMappings: React.Dispatch<React.SetStateAction<Record<string, ColumnRole>>>;
  sectionMapping: ElementRole;
  setSectionMapping: React.Dispatch<React.SetStateAction<ElementRole>>;
}

const COLUMN_ROLE_OPTIONS: { value: ColumnRole; label: string }[] = [
  { value: 'item_name', label: 'Item Name' },
  { value: 'owner', label: 'Assigned To' },
  { value: 'date', label: 'Date / Deadline' },
  { value: 'metric', label: 'Metric / Measurement' },
  { value: 'member', label: 'Member' },
  { value: 'description', label: 'Description' },
  { value: 'tag', label: 'Tag' },
  { value: 'skip', label: 'Skip / Ignore' },
];

export function MappingInterface({
  sheetDetection,
  levels,
  onApply,
  columnMappings,
  setColumnMappings,
  sectionMapping,
  setSectionMapping,
}: MappingInterfaceProps) {
  const hasSections = sheetDetection.sections.some(s => s.headerText);
  const isStrategy = sheetDetection.hasStrategyPattern;
  const [measurementMode, setMeasurementMode] = useState<MeasurementMode>('level4');

  // Live preview
  const preview = useMemo(() => {
    const config: MappingConfig = {
      selectedSheetIndices: [0],
      sectionMapping,
      columnMappings,
      levels,
      measurementMode,
    };
    const { items } = generatePlanItems(sheetDetection, config);
    return items.slice(0, 15);
  }, [sheetDetection, sectionMapping, columnMappings, levels, measurementMode]);

  const handleApply = () => {
    const config: MappingConfig = {
      selectedSheetIndices: [0],
      sectionMapping,
      columnMappings,
      levels,
      measurementMode,
    };
    onApply(config);
  };

  const hasItemName = Object.values(columnMappings).includes('item_name');
  const hasMetricMapped = Object.values(columnMappings).includes('metric');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: Mapping Controls */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Column Mapping</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {sheetDetection.allColumnHeaders.map(col => (
              <div key={col} className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium truncate flex-1 min-w-0">{col}</span>
                <Select
                  value={columnMappings[col] || 'skip'}
                  onValueChange={(v) =>
                    setColumnMappings(prev => ({ ...prev, [col]: v as ColumnRole }))
                  }
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COLUMN_ROLE_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Measurement mode toggle — only when strategy pattern + metric column mapped */}
        {isStrategy && hasMetricMapped && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Measurement Handling</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  How should the Outcome/Measurement column be handled?
                </p>
                <Select
                  value={measurementMode}
                  onValueChange={(v) => setMeasurementMode(v as MeasurementMode)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="level4">Create as Level 4 (Measurement)</SelectItem>
                    <SelectItem value="metric_on_parent">Store as metric on parent Action</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        )}

        {hasSections && !isStrategy && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Section Headers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  How should section headers (e.g., "{sheetDetection.sections.find(s => s.headerText)?.headerText}") be mapped?
                </p>
                <Select
                  value={sectionMapping.type === 'level' ? `level-${sectionMapping.depth}` : sectionMapping.type}
                  onValueChange={(v) => {
                    if (v.startsWith('level-')) {
                      setSectionMapping({ type: 'level', depth: Number(v.split('-')[1]) });
                    } else if (v === 'tag') {
                      setSectionMapping({ type: 'tag' });
                    } else {
                      setSectionMapping({ type: 'skip' });
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {levels.map(l => (
                      <SelectItem key={l.depth} value={`level-${l.depth}`}>
                        Level {l.depth} ({l.name})
                      </SelectItem>
                    ))}
                    <SelectItem value="tag">Tag (not a level)</SelectItem>
                    <SelectItem value="skip">Skip / Ignore</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        )}

        {isStrategy && (
          <div className="text-xs text-muted-foreground flex items-center gap-1 px-1">
            <Info className="h-3 w-3 shrink-0" />
            <span>Strategy pattern detected: hierarchy auto-mapped as {levels.map(l => l.name).join(' → ')}</span>
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={handleApply} disabled={!hasItemName && !isStrategy}>
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Apply Mapping
          </Button>
        </div>

        {!hasItemName && !isStrategy && (
          <p className="text-xs text-destructive text-right">
            Please map at least one column to "Item Name"
          </p>
        )}
      </div>

      {/* Right: Live Preview */}
      <Card className="h-fit">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            Live Preview
            <Badge variant="secondary" className="text-xs">{preview.length} items</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {preview.length === 0 ? (
            <p className="text-sm text-muted-foreground">Map a column to "Item Name" to see a preview</p>
          ) : (
            <div className="space-y-0.5 max-h-[500px] overflow-y-auto">
              {preview.map((item, i) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm ${
                    i % 2 === 0 ? 'bg-muted/30' : ''
                  }`}
                  style={{ paddingLeft: `${12 + (item.levelDepth - 1) * 24}px` }}
                >
                  <Badge variant="outline" className="text-xs shrink-0">{item.levelName}</Badge>
                  <span className="truncate">{item.name}</span>
                  {item.assignedTo && (
                    <span className="text-xs text-muted-foreground ml-auto shrink-0">
                      {item.assignedTo}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
