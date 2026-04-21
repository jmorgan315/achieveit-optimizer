import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PlanItem, PersonMapping, PlanLevel, DEFAULT_LEVELS } from '@/types/plan';
import {
  parseSpreadsheetFile,
  detectStructure,
  generatePlanItems,
  mergeSheetDetections,
  getDefaultColumnRole,
  getDefaultSheetSelection,
  StructureDetection,
  ColumnRole,
  ElementRole,
  MappingConfig,
  MeasurementMode,
  STRATEGY_LEVELS,
} from '@/utils/spreadsheet-parser';
import { DetectionSummary } from '@/components/spreadsheet/DetectionSummary';
import { MappingInterface } from '@/components/spreadsheet/MappingInterface';
import { Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

type Phase = 'parsing' | 'detection' | 'mapping' | 'generating';

interface SpreadsheetImportStepProps {
  file: File;
  sessionId: string;
  onComplete: (items: PlanItem[], personMappings: PersonMapping[], levels: PlanLevel[]) => void;
}

export function SpreadsheetImportStep({ file, sessionId, onComplete }: SpreadsheetImportStepProps) {
  const [phase, setPhase] = useState<Phase>('parsing');
  const [detection, setDetection] = useState<StructureDetection | null>(null);
  const [selectedSheetIndices, setSelectedSheetIndices] = useState<number[]>([]);

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

        // Default sheet selection
        const defaultIndices = getDefaultSheetSelection(det.sheets);
        setSelectedSheetIndices(defaultIndices);

        // Set levels based on pattern
        if (det.hasStrategyPattern) {
          setLevels(STRATEGY_LEVELS);
        }

        // Set default column mappings from first selected sheet
        const firstIdx = defaultIndices[0] ?? 0;
        const recSheet = det.sheets[firstIdx];
        if (recSheet) {
          const defaults: Record<string, ColumnRole> = {};
          recSheet.allColumnHeaders.forEach(col => {
            defaults[col] = getDefaultColumnRole(col);
          });
          setColumnMappings(defaults);

          if (det.hasStrategyPattern) {
            // Strategy pattern: section mapping is handled automatically
            setSectionMapping({ type: 'level', depth: 1 });
          } else {
            const hasSections = recSheet.sections.some(s => s.headerText);
            setSectionMapping(hasSections ? { type: 'level', depth: 1 } : { type: 'skip' });
          }
        }

        setPhase('detection');
      } catch (err) {
        console.error('Spreadsheet parse error:', err);
        setPhase('detection');
      }
    })();
  }, [file]);

  const handleSheetSelect = (indices: number[]) => {
    setSelectedSheetIndices(indices);
    // Update column mappings from first selected sheet
    if (detection && indices.length > 0) {
      const sd = detection.sheets[indices[0]];
      if (sd) {
        const defaults: Record<string, ColumnRole> = {};
        sd.allColumnHeaders.forEach(col => {
          defaults[col] = getDefaultColumnRole(col);
        });
        setColumnMappings(defaults);
      }
    }
  };

  const handleContinueToMapping = () => {
    setPhase('mapping');
  };

  const handleApplyMapping = async (config: MappingConfig) => {
    if (!detection) return;
    setPhase('generating');

    // Merge selected sheets
    const selectedDetections = selectedSheetIndices.map(i => detection.sheets[i]).filter(Boolean);
    const merged = mergeSheetDetections(selectedDetections);
    const { items, personMappings } = generatePlanItems(merged, {
      ...config,
      levels,
    });

    // Build nested tree for admin preview
    const buildTree = (flatItems: PlanItem[]) => {
      const childrenMap = new Map<string | null, PlanItem[]>();
      for (const it of flatItems) {
        const pid = it.parentId ?? null;
        if (!childrenMap.has(pid)) childrenMap.set(pid, []);
        childrenMap.get(pid)!.push(it);
      }
      const toNode = (it: PlanItem): any => ({
        name: it.name,
        levelType: it.levelName,
        confidence: it.confidence ?? 100,
        children: (childrenMap.get(it.id) || []).map(toNode),
      });
      return (childrenMap.get(null) || []).map(toNode);
    };

    const sheetNames = selectedSheetIndices.map(i => detection.sheets[i]?.sheet.name).filter(Boolean);

    // Mark session as completed (awaited so the row update lands before transition).
    const { error: updateError } = await supabase
      .from('processing_sessions')
      .update({
        extraction_method: 'spreadsheet',
        total_items_extracted: items.length,
        status: 'completed',
        document_type: file.name.split('.').pop() || 'xlsx',
        step_results: {
          success: true,
          method: 'spreadsheet',
          data: { items: buildTree(items) },
          totalItems: items.length,
          sessionConfidence: 100,
          extractionMethod: 'spreadsheet',
          mappingConfig: {
            columnMappings: config.columnMappings,
            sectionMapping: config.sectionMapping,
            measurementMode: config.measurementMode,
          },
          sheetsProcessed: sheetNames,
          hasStrategyPattern: detection.hasStrategyPattern,
        } as any,
      })
      .eq('id', sessionId);

    if (updateError) {
      console.error('[Session] Failed to mark spreadsheet session complete:', updateError);
      toast({
        title: 'Heads up',
        description: 'Failed to mark session complete. Continuing anyway.',
        variant: 'destructive',
      });
    }

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
        selectedSheetIndices={selectedSheetIndices}
        onSelectSheets={handleSheetSelect}
        onContinue={handleContinueToMapping}
      />
    );
  }

  if (phase === 'mapping' && detection) {
    const selectedDetections = selectedSheetIndices.map(i => detection.sheets[i]).filter(Boolean);
    const merged = mergeSheetDetections(selectedDetections);
    return (
      <MappingInterface
        sheetDetection={merged}
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
