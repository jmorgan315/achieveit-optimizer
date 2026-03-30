import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PlanItem, PersonMapping, PlanLevel, DEFAULT_LEVELS } from '@/types/plan';
import {
  parseSpreadsheetFile,
  detectStructure,
  generatePlanItems,
  getDefaultColumnRole,
  StructureDetection,
  SheetDetection,
  ColumnRole,
  ElementRole,
  MappingConfig,
} from '@/utils/spreadsheet-parser';
import { DetectionSummary } from '@/components/spreadsheet/DetectionSummary';
import { MappingInterface } from '@/components/spreadsheet/MappingInterface';
import { Loader2 } from 'lucide-react';

type Phase = 'parsing' | 'detection' | 'mapping' | 'generating';

interface SpreadsheetImportStepProps {
  file: File;
  sessionId: string;
  onComplete: (items: PlanItem[], personMappings: PersonMapping[], levels: PlanLevel[]) => void;
}

export function SpreadsheetImportStep({ file, sessionId, onComplete }: SpreadsheetImportStepProps) {
  const [phase, setPhase] = useState<Phase>('parsing');
  const [detection, setDetection] = useState<StructureDetection | null>(null);
  const [selectedSheetIndex, setSelectedSheetIndex] = useState(0);

  // Mapping state
  const [columnMappings, setColumnMappings] = useState<Record<string, ColumnRole>>({});
  const [sectionMapping, setSectionMapping] = useState<ElementRole>({ type: 'level', depth: 1 });
  const [levels, setLevels] = useState<PlanLevel[]>(DEFAULT_LEVELS.slice(0, 3));

  // Parse on mount
  useEffect(() => {
    (async () => {
      try {
        const sheets = await parseSpreadsheetFile(file);
        const det = detectStructure(sheets);
        setDetection(det);
        setSelectedSheetIndex(det.recommendedSheetIndex);

        // Set default column mappings for recommended sheet
        const recSheet = det.sheets[det.recommendedSheetIndex];
        if (recSheet) {
          const defaults: Record<string, ColumnRole> = {};
          recSheet.allColumnHeaders.forEach(col => {
            defaults[col] = getDefaultColumnRole(col);
          });
          setColumnMappings(defaults);

          // If sections exist, default section headers to Level 1
          const hasSections = recSheet.sections.some(s => s.headerText);
          if (hasSections) {
            setSectionMapping({ type: 'level', depth: 1 });
          } else {
            setSectionMapping({ type: 'skip' });
          }
        }

        setPhase('detection');
      } catch (err) {
        console.error('Spreadsheet parse error:', err);
        setPhase('detection');
      }
    })();
  }, [file]);

  const handleSheetSelect = (idx: number) => {
    setSelectedSheetIndex(idx);
    if (detection) {
      const sd = detection.sheets[idx];
      const defaults: Record<string, ColumnRole> = {};
      sd.allColumnHeaders.forEach(col => {
        defaults[col] = getDefaultColumnRole(col);
      });
      setColumnMappings(defaults);
    }
  };

  const handleContinueToMapping = () => {
    setPhase('mapping');
  };

  const handleApplyMapping = (config: MappingConfig) => {
    if (!detection) return;
    setPhase('generating');

    const sd = detection.sheets[selectedSheetIndex];
    const { items, personMappings } = generatePlanItems(sd, {
      ...config,
      levels,
    });

    // Update session
    supabase.from('processing_sessions').upsert({
      id: sessionId,
      extraction_method: 'spreadsheet',
      total_items_extracted: items.length,
      status: 'completed',
      document_type: file.name.split('.').pop() || 'xlsx',
      step_results: {
        success: true,
        method: 'spreadsheet',
        mappingConfig: {
          columnMappings: config.columnMappings,
          sectionMapping: config.sectionMapping,
        },
        sheetsProcessed: 1,
        sheetName: sd.sheet.name,
        totalItems: items.length,
        duplicatesRemoved: sd.totalDataRows - items.length,
      } as any,
    }, { onConflict: 'id' }).then(({ error }) => {
      if (error) console.error('[Session] Failed to update spreadsheet session:', error);
    });

    onComplete(items, personMappings, levels);
  };

  if (phase === 'parsing') {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Analyzing spreadsheet…</p>
      </div>
    );
  }

  if (phase === 'generating') {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Generating plan items…</p>
      </div>
    );
  }

  if (phase === 'detection' && detection) {
    return (
      <DetectionSummary
        detection={detection}
        selectedSheetIndex={selectedSheetIndex}
        onSelectSheet={handleSheetSelect}
        onContinue={handleContinueToMapping}
      />
    );
  }

  if (phase === 'mapping' && detection) {
    return (
      <MappingInterface
        sheetDetection={detection.sheets[selectedSheetIndex]}
        levels={levels}
        onApply={handleApplyMapping}
        columnMappings={columnMappings}
        setColumnMappings={setColumnMappings}
        sectionMapping={sectionMapping}
        setSectionMapping={setSectionMapping}
      />
    );
  }

  return null;
}
