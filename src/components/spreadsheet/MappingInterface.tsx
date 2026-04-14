import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle2, Info } from 'lucide-react';
import {
  SheetDetection,
  ColumnRole,
  ElementRole,
  MappingConfig,
  MeasurementMode,
  generatePlanItems,
} from '@/utils/spreadsheet-parser';
import { PlanLevel } from '@/types/plan';

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
