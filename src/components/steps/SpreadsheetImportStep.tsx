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
  stemKey,
} from '@/utils/parsers/parseHierarchicalColumns';
import { DetectionSummary } from '@/components/spreadsheet/DetectionSummary';
import { MappingInterface, LevelConflictBlock, LevelChoice } from '@/components/spreadsheet/MappingInterface';
import { Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { logParserDiagnostic } from '@/utils/parserDiagnostics';

type Phase = 'parsing' | 'detection' | 'mapping' | 'generating' | 'level-conflict';

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
  userLevels?: string[];
  onComplete: (items: PlanItem[], personMappings: PersonMapping[], levels: PlanLevel[]) => void;
}

const PREVIEW_MAX_ROWS = 30;
const PREVIEW_MAX_COLS = 12;
const DISPATCH_CONFIDENCE_THRESHOLD = 80;

/** True iff two level arrays are equivalent under stem-fold normalization. */
function levelsEquivalent(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (stemKey(a[i]) !== stemKey(b[i])) return false;
  }
  return true;
}

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
  userLevels,
  onComplete,
}: SpreadsheetImportStepProps) {
  const [phase, setPhase] = useState<Phase>('parsing');
  const [detection, setDetection] = useState<StructureDetection | null>(null);
  const [selectedSheetIndices, setSelectedSheetIndices] = useState<number[]>([]);

  // Mapping state
  const [columnMappings, setColumnMappings] = useState<Record<string, ColumnRole>>({});
  const [sectionMapping, setSectionMapping] = useState<ElementRole>({ type: 'level', depth: 1 });
  const [levels, setLevels] = useState<PlanLevel[]>(DEFAULT_LEVELS.slice(0, 3));

  // Phase 4b.2: per-sheet conflict tracking + effective level overrides.
  // `pendingConflicts` is a queue of sheets the user must resolve before completion.
  // `effectiveLevelsBySheet` records the user's choice (or auto-applied levels) per sheet.
  interface PendingConflict {
    sheetName: string;
    userLevels: string[];
    classifierLevels: string[];
    sheetClassification: SheetClassification;
    parsedSheet: import('@/utils/spreadsheet-parser').ParsedSheet;
    initialItemCount: number;
  }
  const [pendingConflicts, setPendingConflicts] = useState<PendingConflict[]>([]);
  const [conflictApplyBusy, setConflictApplyBusy] = useState(false);
  // Snapshot of the in-progress hierarchical results, keyed by sheet name, so
  // we can swap one sheet's items after a re-parse without rerunning others.
  const [hierResultsBySheet, setHierResultsBySheet] = useState<
    Record<string, { items: PlanItem[]; personMappings: PersonMapping[]; resolvedLevels: string[] }>
  >({});
  const [hierSheetOrder, setHierSheetOrder] = useState<string[]>([]);

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
        // === Phase 4b.1/4b.2 dispatch ===
        // Pure synchronous switch on a discriminated-union result, so the
        // conflict path can never race past `setPhase('level-conflict')`.
        if (validPreselected && validPreselected.length > 0) {
          const result = await tryDispatchHierarchical({
            sessionId,
            file,
            parsedSheets: sheets,
            selectedIndices: validPreselected,
          });
          if (result.kind === 'completed') {
            await persistAndComplete(result.payload);
            return;
          }
          if (result.kind === 'conflicts') {
            setHierResultsBySheet(result.perSheet);
            setHierSheetOrder(result.sheetNames);
            setPendingConflicts(result.conflicts);
            setPhase('level-conflict');
            return;
          }
          // result.kind === 'fallback' → fall through to existing mapping flow
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

  // Phase 4b.2 belt-and-braces guard: if any code path ever populates
  // pendingConflicts without switching phase, force the conflict screen
  // rather than silently rendering the legacy mapping UI.
  useEffect(() => {
    if (pendingConflicts.length > 0 && phase !== 'level-conflict' && phase !== 'generating') {
      console.warn('[ssphase4b] guard: pendingConflicts present but phase=', phase, '— forcing level-conflict');
      setPhase('level-conflict');
    }
  }, [pendingConflicts, phase]);

  // ── Hierarchical dispatch helpers ────────────────────────────────────────

  type HierPerSheet = Record<string, { items: PlanItem[]; personMappings: PersonMapping[]; resolvedLevels: string[] }>;
  type DispatchResult =
    | { kind: 'completed'; payload: { items: PlanItem[]; personMappings: PersonMapping[]; levels: PlanLevel[]; sheetNames: string[] } }
    | { kind: 'conflicts'; conflicts: PendingConflict[]; perSheet: HierPerSheet; sheetNames: string[] }
    | { kind: 'fallback'; reason: string };

  /**
   * Pure decision producer: parses + logs, then returns a discriminated union.
   * Does NOT mutate React state. Caller is responsible for setState based on
   * the returned `kind`.
   */
  async function tryDispatchHierarchical(args: {
    sessionId: string;
    file: File;
    parsedSheets: import('@/utils/spreadsheet-parser').ParsedSheet[];
    selectedIndices: number[];
  }): Promise<DispatchResult> {
    console.log('[ssphase4b] ENTERED tryDispatchHierarchical, selectedIndices:', args.selectedIndices, 'sheetCount:', args.parsedSheets.length);
    void logParserDiagnostic(args.sessionId, 'dispatcher', 'entry', {
      selectedIndices: args.selectedIndices,
      sheetCount: args.parsedSheets.length,
    });
    // Fetch layout_classification for this session.
    const { data, error } = await supabase
      .from('processing_sessions')
      .select('layout_classification')
      .eq('id', args.sessionId)
      .maybeSingle();

    if (error || !data?.layout_classification) {
      console.log('[ssphase4b] dispatch: no layout_classification → fallback');
      void logParserDiagnostic(args.sessionId, 'dispatcher', 'dispatch', {
        outcome: 'fallback',
        reason: 'no layout_classification',
        error: error?.message ?? null,
      });
      return { kind: 'fallback', reason: 'no layout_classification' };
    }

    const cls = data.layout_classification as unknown as LayoutClassification;
    if (cls.error || !cls.sheets || cls.sheets.length === 0) {
      console.log('[ssphase4b] dispatch: layout_classification empty/error → fallback');
      void logParserDiagnostic(args.sessionId, 'dispatcher', 'dispatch', {
        outcome: 'fallback',
        reason: 'layout_classification empty/error',
        clsError: cls.error ?? null,
      });
      return { kind: 'fallback', reason: 'layout_classification empty/error' };
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
      const routePayload = {
        sheet: sheet.name,
        pattern: cls?.pattern ?? 'unknown',
        confidence: cls?.confidence ?? null,
        dispatchedTo: decision.kind === 'hierarchical' ? 'parseHierarchicalColumns' : 'detectGenericPattern',
        reason: decision.kind === 'generic' ? decision.reason : (decision.lowConfidence ? 'low-confidence' : 'ok'),
      };
      console.log('[ssphase4b] route:', JSON.stringify(routePayload));
      void logParserDiagnostic(args.sessionId, 'dispatcher', 'route', routePayload, sheet.name);
      return { sheet, cls, decision };
    });

    // 4b.1: only short-circuit when every selected sheet is hierarchical.
    const allHierarchical = selected.every(s => s.decision.kind === 'hierarchical');
    if (!allHierarchical) {
      console.log('[ssphase4b] dispatch: mixed routing → falling back to existing mapping flow');
      void logParserDiagnostic(args.sessionId, 'dispatcher', 'dispatch', {
        outcome: 'fallback',
        reason: 'mixed routing',
        perSheet: selected.map(s => ({ sheet: s.sheet.name, kind: s.decision.kind })),
      });
      return { kind: 'fallback', reason: 'mixed routing' };
    }

    // Run the parser per sheet, accumulate results.
    const personSet = new Set<string>();
    const levelNamesUnion: string[] = [];
    const sheetNames: string[] = [];
    const perSheet: HierPerSheet = {};
    const conflicts: PendingConflict[] = [];

    for (const s of selected) {
      if (s.decision.kind !== 'hierarchical' || !s.cls) continue;
      if (s.decision.lowConfidence) {
        console.warn('[ssphase4b] low-confidence dispatch:', s.sheet.name, 'pattern=', s.cls.pattern, 'confidence=', s.cls.confidence);
      }

      const implied = s.cls.structure?.implied_levels ?? [];
      const hasUser = !!(userLevels && userLevels.length > 0);
      const effective = hasUser ? userLevels! : implied;

      void logParserDiagnostic(args.sessionId, 'parseHierarchicalColumns', 'levels-source', {
        sheet: s.sheet.name,
        source: hasUser ? 'user' : 'classifier',
        levels: effective,
        classifierLevels: implied,
      }, s.sheet.name);

      const equivalent = hasUser && implied.length > 0
        ? levelsEquivalent(userLevels, implied)
        : true; // no comparison possible → no conflict
      const detected = hasUser && implied.length > 0 && !equivalent;
      const reason = !hasUser || implied.length === 0
        ? 'none'
        : equivalent
          ? 'none'
          : userLevels!.length !== implied.length
            ? 'length-mismatch'
            : 'name-mismatch';
      void logParserDiagnostic(args.sessionId, 'parseHierarchicalColumns', 'level-conflict', {
        sheet: s.sheet.name,
        detected,
        reason,
        userLevels: userLevels ?? [],
        classifierLevels: implied,
      }, s.sheet.name);

      const result = parseHierarchicalColumns(s.sheet, s.cls, hasUser ? userLevels : undefined, args.sessionId);
      perSheet[s.sheet.name] = {
        items: result.items,
        personMappings: result.personMappings,
        resolvedLevels: result.resolvedLevels,
      };
      result.resolvedLevels.forEach(name => {
        if (name && !levelNamesUnion.includes(name)) levelNamesUnion.push(name);
      });
      result.personMappings.forEach(p => personSet.add(p.foundName));
      sheetNames.push(s.sheet.name);

      if (detected) {
        conflicts.push({
          sheetName: s.sheet.name,
          userLevels: userLevels!,
          classifierLevels: implied,
          sheetClassification: s.cls,
          parsedSheet: s.sheet,
          initialItemCount: result.items.length,
        });
      }
    }

    if (conflicts.length > 0) {
      // Caller will stash perSheet/sheetNames and switch phase.
      return { kind: 'conflicts', conflicts, perSheet, sheetNames };
    }

    const allItems: PlanItem[] = sheetNames.flatMap(n => perSheet[n]?.items ?? []);
    const resolvedLevels: PlanLevel[] = levelNamesUnion.length > 0
      ? levelNamesUnion.map((name, i) => ({ id: String(i + 1), name, depth: i + 1 }))
      : DEFAULT_LEVELS.slice(0, 3);

    const personMappings: PersonMapping[] = Array.from(personSet).map((name, i) => ({
      id: String(i + 1),
      foundName: name,
      email: '',
      isResolved: false,
    }));

    return {
      kind: 'completed',
      payload: { items: allItems, personMappings, levels: resolvedLevels, sheetNames },
    };
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

  // ── Phase 4b.2: conflict resolution apply ───────────────────────────────
  const handleApplyLevelChoice = async (
    conflict: { sheetName: string; userLevels: string[]; classifierLevels: string[]; sheetClassification: SheetClassification; parsedSheet: import('@/utils/spreadsheet-parser').ParsedSheet; initialItemCount: number },
    choice: LevelChoice,
  ) => {
    if (choice === 'reconfigure') {
      // Drop the queue entirely and fall through to the existing toggle UI.
      setPendingConflicts([]);
      setPhase('mapping');
      return;
    }

    setConflictApplyBusy(true);
    try {
      const newLevels = choice === 'user' ? conflict.userLevels : conflict.classifierLevels;
      const itemsBefore = hierResultsBySheet[conflict.sheetName]?.items.length ?? conflict.initialItemCount;
      const result = parseHierarchicalColumns(conflict.parsedSheet, conflict.sheetClassification, newLevels, sessionId);
      const itemsAfter = result.items.length;

      void logParserDiagnostic(sessionId, 'parseHierarchicalColumns', 'reparsed', {
        sheet: conflict.sheetName,
        trigger: 'user-apply',
        choice,
        newLevels,
        itemsBefore,
        itemsAfter,
      }, conflict.sheetName);

      setHierResultsBySheet(prev => ({
        ...prev,
        [conflict.sheetName]: {
          items: result.items,
          personMappings: result.personMappings,
          resolvedLevels: result.resolvedLevels,
        },
      }));

      // Pop this conflict; if more remain, stay on the screen.
      setPendingConflicts(prev => {
        const next = prev.filter(c => c.sheetName !== conflict.sheetName);
        if (next.length === 0) {
          // All conflicts resolved — finalize using current snapshots.
          // Defer using a microtask so the state update lands first.
          queueMicrotask(() => finalizeFromHierSnapshots());
        }
        return next;
      });
    } finally {
      setConflictApplyBusy(false);
    }
  };

  const finalizeFromHierSnapshots = async () => {
    // Read latest snapshot via state setter pattern to avoid stale closure.
    let snapshots: typeof hierResultsBySheet = {};
    let order: string[] = [];
    setHierResultsBySheet(prev => { snapshots = prev; return prev; });
    setHierSheetOrder(prev => { order = prev; return prev; });

    const allItems: PlanItem[] = order.flatMap(n => snapshots[n]?.items ?? []);
    const personSet = new Set<string>();
    const levelNamesUnion: string[] = [];
    for (const n of order) {
      const r = snapshots[n];
      if (!r) continue;
      r.personMappings.forEach(p => personSet.add(p.foundName));
      r.resolvedLevels.forEach(name => {
        if (name && !levelNamesUnion.includes(name)) levelNamesUnion.push(name);
      });
    }
    const resolvedLevels: PlanLevel[] = levelNamesUnion.length > 0
      ? levelNamesUnion.map((name, i) => ({ id: String(i + 1), name, depth: i + 1 }))
      : DEFAULT_LEVELS.slice(0, 3);
    const personMappings: PersonMapping[] = Array.from(personSet).map((name, i) => ({
      id: String(i + 1), foundName: name, email: '', isResolved: false,
    }));

    await persistAndComplete({
      items: allItems,
      personMappings,
      levels: resolvedLevels,
      sheetNames: order,
    });
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

  if (phase === 'level-conflict' && pendingConflicts.length > 0) {
    const current = pendingConflicts[0];
    return (
      <div className="w-full max-w-4xl mx-auto space-y-4">
        {pendingConflicts.length > 1 && (
          <p className="text-xs text-muted-foreground">
            Resolving level conflicts ({pendingConflicts.length} sheet{pendingConflicts.length === 1 ? '' : 's'} remaining)
          </p>
        )}
        <LevelConflictBlock
          sheetName={current.sheetName}
          userLevels={current.userLevels}
          classifierLevels={current.classifierLevels}
          busy={conflictApplyBusy}
          onApply={(choice) => handleApplyLevelChoice(current, choice)}
        />
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
