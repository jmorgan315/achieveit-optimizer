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
import {
  parseHierarchicalColumns,
  SheetClassification,
} from '@/utils/parsers/parseHierarchicalColumns';
import { DetectionSummary } from '@/components/spreadsheet/DetectionSummary';
import { MappingInterface } from '@/components/spreadsheet/MappingInterface';
import { Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { logParserDiagnostic } from '@/utils/parserDiagnostics';

type Phase = 'parsing' | 'detection' | 'mapping' | 'generating';

interface LayoutClassification {
  sheets?: SheetClassification[];
  error?: string;
  [k: string]: unknown;
}

interface SpreadsheetImportStepProps {
  file: File;
  sessionId: string;
  orgName?: string;
  documentHints?: string;
  preselectedSheetIndices?: number[];
  onComplete: (items: PlanItem[], personMappings: PersonMapping[], levels: PlanLevel[]) => void;
}

const PREVIEW_MAX_ROWS = 30;
const PREVIEW_MAX_COLS = 12;
const DISPATCH_CONFIDENCE_THRESHOLD = 80;

// Decide which parser handles a given sheet, based on classifier output.
// Pure function — no test-file-specific heuristics. Pattern + confidence only.
type Dispatch =
  | { kind: 'hierarchical'; lowConfidence: boolean }
  | { kind: 'generic'; reason: string };

function decideDispatch(cls: SheetClassification | undefined): Dispatch {
  if (!cls || !cls.structure) return { kind: 'generic', reason: 'no-classification' };
  const pattern = cls.pattern;
  const conf = typeof cls.confidence === 'number' ? cls.confidence : 0;
  if (pattern === 'B' || pattern === 'C') {
    return { kind: 'hierarchical', lowConfidence: conf < DISPATCH_CONFIDENCE_THRESHOLD };
  }
  if (pattern === 'D') return { kind: 'generic', reason: 'pattern-d-deferred' };
  return { kind: 'generic', reason: `pattern-${pattern}` };
}

export function SpreadsheetImportStep({
  file,
  sessionId,
  orgName,
  documentHints,
  preselectedSheetIndices,
  onComplete,
}: SpreadsheetImportStepProps) {
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

        // Honor preselected indices from SheetPickerStep when provided.
        const validPreselected = preselectedSheetIndices?.filter(i => i >= 0 && i < det.sheets.length);
        const initialIndices =
          validPreselected && validPreselected.length > 0
            ? validPreselected
            : getDefaultSheetSelection(det.sheets);
        setSelectedSheetIndices(initialIndices);

        if (det.hasStrategyPattern) {
          setLevels(STRATEGY_LEVELS);
        }

        // Set default column mappings from first selected sheet
        const firstIdx = initialIndices[0] ?? 0;
        const recSheet = det.sheets[firstIdx];
        if (recSheet) {
          const defaults: Record<string, ColumnRole> = {};
          recSheet.allColumnHeaders.forEach(col => {
            defaults[col] = getDefaultColumnRole(col);
          });
          setColumnMappings(defaults);

          if (det.hasStrategyPattern) {
            setSectionMapping({ type: 'level', depth: 1 });
          } else {
            const hasSections = recSheet.sections.some(s => s.headerText);
            setSectionMapping(hasSections ? { type: 'level', depth: 1 } : { type: 'skip' });
          }
        }

        console.log('[ssphase4b] useEffect post-detect: preselectedSheetIndices=', preselectedSheetIndices, 'validPreselected=', validPreselected, 'sheetCount=', det.sheets.length);
        void logParserDiagnostic(sessionId, 'dispatcher', 'useEffect-post-detect', {
          preselectedSheetIndices: preselectedSheetIndices ?? null,
          validPreselected: validPreselected ?? null,
          sheetCount: det.sheets.length,
          sheetNames: sheets.map(s => s.name),
        });
        // === Phase 4b.1 dispatch ===
        // If picker pre-selected sheets AND every selected sheet routes to the
        // hierarchical parser, run it end-to-end and skip the mapping screen.
        // Otherwise (mixed or A/D/unknown), fall through to existing flow.
        if (validPreselected && validPreselected.length > 0) {
          const dispatched = await tryDispatchHierarchical({
            sessionId,
            file,
            parsedSheets: sheets,
            selectedIndices: validPreselected,
          });
          if (dispatched) {
            await persistAndComplete(dispatched);
            return;
          }
        }

        // If user already picked sheets in SheetPickerStep, jump past detection.
        setPhase(validPreselected && validPreselected.length > 0 ? 'mapping' : 'detection');
      } catch (err) {
        console.error('Spreadsheet parse error:', err);
        setPhase('detection');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // ── Hierarchical dispatch helpers ────────────────────────────────────────

  /**
   * Returns parsed items+mappings if and only if every selected sheet routes
   * to the hierarchical parser. Returns null otherwise (caller falls back).
   */
  async function tryDispatchHierarchical(args: {
    sessionId: string;
    file: File;
    parsedSheets: import('@/utils/spreadsheet-parser').ParsedSheet[];
    selectedIndices: number[];
  }): Promise<null | {
    items: PlanItem[];
    personMappings: PersonMapping[];
    levels: PlanLevel[];
    sheetNames: string[];
  }> {
    console.log('[ssphase4b] ENTERED tryDispatchHierarchical, selectedIndices:', args.selectedIndices, 'sheetCount:', args.parsedSheets.length);
    // Fetch layout_classification for this session.
    const { data, error } = await supabase
      .from('processing_sessions')
      .select('layout_classification')
      .eq('id', args.sessionId)
      .maybeSingle();

    if (error || !data?.layout_classification) {
      console.log('[ssphase4b] dispatch: no layout_classification → fallback');
      return null;
    }

    const cls = data.layout_classification as unknown as LayoutClassification;
    if (cls.error || !cls.sheets || cls.sheets.length === 0) {
      console.log('[ssphase4b] dispatch: layout_classification empty/error → fallback');
      return null;
    }

    const clsBySheetName = new Map<string, SheetClassification>();
    cls.sheets.forEach(s => clsBySheetName.set(s.sheet_name, s));

    // Decide dispatch per selected sheet.
    type Selected = {
      sheet: import('@/utils/spreadsheet-parser').ParsedSheet;
      cls: SheetClassification | undefined;
      decision: Dispatch;
    };
    const selected: Selected[] = args.selectedIndices.map(idx => {
      const sheet = args.parsedSheets[idx];
      const cls = clsBySheetName.get(sheet.name);
      const decision = decideDispatch(cls);
      console.log(
        '[ssphase4b] route:',
        JSON.stringify({
          sheet: sheet.name,
          pattern: cls?.pattern ?? 'unknown',
          confidence: cls?.confidence ?? null,
          dispatchedTo: decision.kind === 'hierarchical' ? 'parseHierarchicalColumns' : 'detectGenericPattern',
          reason: decision.kind === 'generic' ? decision.reason : (decision.lowConfidence ? 'low-confidence' : 'ok'),
        }),
      );
      return { sheet, cls, decision };
    });

    // 4b.1: only short-circuit when every selected sheet is hierarchical.
    const allHierarchical = selected.every(s => s.decision.kind === 'hierarchical');
    if (!allHierarchical) {
      console.log('[ssphase4b] dispatch: mixed routing → falling back to existing mapping flow');
      return null;
    }

    // Run the parser per sheet, accumulate results.
    const allItems: PlanItem[] = [];
    const personSet = new Set<string>();
    const levelNamesUnion: string[] = [];
    const sheetNames: string[] = [];

    for (const s of selected) {
      if (s.decision.kind !== 'hierarchical' || !s.cls) continue;
      if (s.decision.lowConfidence) {
        console.warn('[ssphase4b] low-confidence dispatch:', s.sheet.name, 'pattern=', s.cls.pattern, 'confidence=', s.cls.confidence);
      }
      const result = parseHierarchicalColumns(s.sheet, s.cls, undefined);
      // Collect canonical level name ordering across sheets (first wins).
      result.resolvedLevels.forEach(name => {
        if (name && !levelNamesUnion.includes(name)) levelNamesUnion.push(name);
      });
      // Items keep their parentId references intact within this sheet's batch.
      allItems.push(...result.items);
      result.personMappings.forEach(p => personSet.add(p.foundName));
      sheetNames.push(s.sheet.name);
    }

    // Build PlanLevel[] from union (in order).
    const resolvedLevels: PlanLevel[] = levelNamesUnion.length > 0
      ? levelNamesUnion.map((name, i) => ({ id: String(i + 1), name, depth: i + 1 }))
      : DEFAULT_LEVELS.slice(0, 3);

    const personMappings: PersonMapping[] = Array.from(personSet).map((name, i) => ({
      id: String(i + 1),
      foundName: name,
      email: '',
      isResolved: false,
    }));

    return { items: allItems, personMappings, levels: resolvedLevels, sheetNames };
  }

  async function persistAndComplete(payload: {
    items: PlanItem[];
    personMappings: PersonMapping[];
    levels: PlanLevel[];
    sheetNames: string[];
  }) {
    setPhase('generating');

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

    const { error: updateError } = await supabase
      .from('processing_sessions')
      .update({
        extraction_method: 'spreadsheet',
        document_hints: documentHints?.trim() || null,
        total_items_extracted: payload.items.length,
        status: 'completed',
        document_type: file.name.split('.').pop() || 'xlsx',
        step_results: {
          success: true,
          method: 'spreadsheet',
          data: { items: buildTree(payload.items) },
          totalItems: payload.items.length,
          sessionConfidence: 100,
          extractionMethod: 'spreadsheet',
          parser: 'parseHierarchicalColumns',
          sheetsProcessed: payload.sheetNames,
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

    onComplete(payload.items, payload.personMappings, payload.levels);
  }

  // ── Existing flow (unchanged) ───────────────────────────────────────────

  const handleSheetSelect = (indices: number[]) => {
    setSelectedSheetIndices(indices);
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

    const selectedDetections = selectedSheetIndices.map(i => detection.sheets[i]).filter(Boolean);
    const merged = mergeSheetDetections(selectedDetections);
    const { items, personMappings } = generatePlanItems(merged, {
      ...config,
      levels,
    });

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

    const { error: updateError } = await supabase
      .from('processing_sessions')
      .update({
        extraction_method: 'spreadsheet',
        document_hints: documentHints?.trim() || null,
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
