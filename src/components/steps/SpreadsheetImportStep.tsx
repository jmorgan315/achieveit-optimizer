import { useState, useEffect, useRef } from 'react';
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
  CellTransformation,
  remapCellTransformationLevels,
} from '@/utils/parsers/parseHierarchicalColumns';
import { DetectionSummary } from '@/components/spreadsheet/DetectionSummary';
import { MappingInterface, LevelConflictBlock, LevelChoice } from '@/components/spreadsheet/MappingInterface';
import { LevelMappingInterface } from '@/components/spreadsheet/LevelMappingInterface';
import {
  MappingConfirmation,
  SheetSummary,
  DirectivesSummary,
  AttributeMapping,
  PredicateRow,
  CellRuleRow,
  cellRuleKey,
} from '@/components/spreadsheet/MappingConfirmation';
import { parsePredicate, applyPredicate, ParsedPredicate } from '@/utils/parsers/applyRowPredicate';
import { Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { logParserDiagnostic } from '@/utils/parserDiagnostics';

type Phase = 'parsing' | 'detection' | 'mapping' | 'generating' | 'level-conflict' | 'mapping-confirmation' | 'level-mapping';

interface ParserDirectivesShape {
  exclude_sheets?: string[];
  exclude_row_predicates?: string[];
  include_only_recent?: boolean;
  cell_transformations?: CellTransformation[];
}

interface LayoutClassification {
  sheets?: SheetClassification[];
  parser_directives?: ParserDirectivesShape;
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
    Record<string, { items: PlanItem[]; personMappings: PersonMapping[]; resolvedLevels: string[]; resolvedColumnIndices?: number[]; parsedSheet?: import('@/utils/spreadsheet-parser').ParsedSheet; classification?: SheetClassification }>
  >({});
  const [hierSheetOrder, setHierSheetOrder] = useState<string[]>([]);

  // Phase 4d.1 — classifier metadata cached for the confirmation screen so we
  // don't re-fetch layout_classification on render.
  const [clsBySheetName, setClsBySheetName] = useState<Record<string, SheetClassification>>({});
  const [parserDirectives, setParserDirectives] = useState<ParserDirectivesShape | null>(null);
  const [dismissedPredicates, setDismissedPredicates] = useState<Set<string>>(new Set());
  const [dismissedCellRuleKeys, setDismissedCellRuleKeys] = useState<Set<string>>(new Set());

  // Phase 4d.2.b — accumulated active row predicates per sheet, with the
  // pre-apply baseline so Apply/Undo across multiple predicates is order-safe.
  const [activePredicatesBySheet, setActivePredicatesBySheet] = useState<Record<string, string[]>>({});
  const [predicateBaselineBySheet, setPredicateBaselineBySheet] = useState<Record<string, PlanItem[]>>({});
  // Generic (Pattern A) baseline + per-sheet, per-predicate removed counts so
  // the directives card can render "removed N rows" totals.
  const [genericPredicateBaselineBySheet, setGenericPredicateBaselineBySheet] = useState<Record<string, PlanItem[]>>({});
  const [removedCountByPredicateBySheet, setRemovedCountByPredicateBySheet] = useState<Record<string, Record<string, number>>>({});

  // Phase 4d.2.c — accumulated active cell transformations per sheet, with
  // the pre-apply parse-result baseline so Apply/Undo never silently drop a
  // sibling rule.
  const [activeCellTxBySheet, setActiveCellTxBySheet] = useState<Record<string, CellTransformation[]>>({});
  const [cellTxBaselineBySheet, setCellTxBaselineBySheet] = useState<
    Record<string, { items: PlanItem[]; personMappings: PersonMapping[]; resolvedLevels: string[]; resolvedColumnIndices?: number[] }>
  >({});
  // 4d.2.c — per-sheet cells-transformed counts keyed by ruleKey.
  const [cellsTransformedByRuleSheet, setCellsTransformedByRuleSheet] = useState<Record<string, Record<string, number>>>({});
  const cellRulesDetectedLoggedRef = useRef(false);

  // Phase 4d.2.a — when the user clicks "Let me adjust" on a Pattern B/C sheet,
  // we route to the LevelMappingInterface keyed by this target.
  interface LevelMappingTarget {
    sheetName: string;
    classification: SheetClassification;
    parsedSheet: import('@/utils/spreadsheet-parser').ParsedSheet;
    initialLevels: string[];
    initialColumnIndices: number[];
  }
  const [levelMappingTarget, setLevelMappingTarget] = useState<LevelMappingTarget | null>(null);

  // Phase 4d.1.1 — Pattern A preview computed up front so MappingConfirmation
  // can render the same AI Analysis surface for generic-routed sheets.
  interface GenericPreview {
    itemsBySheet: Record<string, PlanItem[]>;
    personMappings: PersonMapping[];
    levels: PlanLevel[];
    columnMappings: Record<string, ColumnRole>;
    sectionMapping: ElementRole;
    measurementMode: MeasurementMode;
  }
  const [genericPreview, setGenericPreview] = useState<GenericPreview | null>(null);

  // Phase 4c.1 — single-fetch dedup of layout_classification across the mount
  // useEffect (for detectStructure hints) and tryDispatchHierarchical.
  const classificationRef = useRef<Promise<LayoutClassification | null> | null>(null);
  function getClassification(): Promise<LayoutClassification | null> {
    if (classificationRef.current) return classificationRef.current;
    classificationRef.current = (async () => {
      const { data, error } = await supabase
        .from('processing_sessions')
        .select('layout_classification')
        .eq('id', sessionId)
        .maybeSingle();
      if (error || !data?.layout_classification) return null;
      return data.layout_classification as unknown as LayoutClassification;
    })();
    return classificationRef.current;
  }

  // Parse on mount
  useEffect(() => {
    (async () => {
      try {
        const sheets = await parseSpreadsheetFile(file);
        // Phase 4c.1 — build classifier hints map for detectStructure.
        const cls = await getClassification();
        let hints: Record<string, import('@/utils/spreadsheet-parser').ClassifierStructureHint> | undefined;
        if (cls && !cls.error && Array.isArray(cls.sheets)) {
          hints = {};
          for (const s of cls.sheets) {
            if (!s?.sheet_name) continue;
            const st = (s.structure || {}) as Partial<import('@/utils/parsers/parseHierarchicalColumns').SheetClassificationStructure> & { section_marker_pattern?: string | null };
            hints[s.sheet_name] = {
              pattern: s.pattern,
              header_row_index: st.header_row_index ?? null,
              data_starts_at_row: st.data_starts_at_row ?? null,
              section_marker_pattern: st.section_marker_pattern ?? null,
              implied_levels: st.implied_levels,
            };
          }
        }
        const det = detectStructure(sheets, hints, sessionId);
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
            detection: det,
          });
          if (
            result.kind === 'completed' ||
            result.kind === 'conflicts' ||
            result.kind === 'generic-confirm' ||
            result.kind === 'mixed-confirm'
          ) {
            setClsBySheetName(result.clsBySheetName);
            setParserDirectives(result.parserDirectives ?? null);
            setHierSheetOrder(result.sheetNames);
            if (result.kind === 'completed' || result.kind === 'conflicts') {
              setHierResultsBySheet(result.perSheet);
              if (result.kind === 'conflicts') setPendingConflicts(result.conflicts);
            } else if (result.kind === 'generic-confirm') {
              setGenericPreview({
                itemsBySheet: result.preview.itemsBySheet,
                personMappings: result.preview.personMappings,
                levels: result.preview.levels,
                columnMappings: result.preview.columnMappings,
                sectionMapping: result.preview.sectionMapping,
                measurementMode: result.preview.measurementMode,
              });
              setColumnMappings(result.preview.columnMappings);
              setSectionMapping(result.preview.sectionMapping);
              setLevels(result.preview.levels);
            } else {
              // mixed-confirm — populate both halves.
              setHierResultsBySheet(result.perSheet);
              if (result.conflicts.length > 0) setPendingConflicts(result.conflicts);
              setGenericPreview({
                itemsBySheet: result.preview.itemsBySheet,
                personMappings: result.preview.personMappings,
                levels: result.preview.levels,
                columnMappings: result.preview.columnMappings,
                sectionMapping: result.preview.sectionMapping,
                measurementMode: result.preview.measurementMode,
              });
              setColumnMappings(result.preview.columnMappings);
              setSectionMapping(result.preview.sectionMapping);
              setLevels(result.preview.levels);
            }
            setPhase('mapping-confirmation');
            void logParserDiagnostic(sessionId, 'ssphase4d', 'mapping-confirmation-shown', {
              source: result.kind === 'generic-confirm'
                ? 'generic'
                : result.kind === 'mixed-confirm'
                  ? 'mixed'
                  : 'hierarchical',
              sheets: result.sheetNames.map(n => ({
                sheet: n,
                pattern: result.clsBySheetName[n]?.pattern ?? 'unknown',
                confidence: result.clsBySheetName[n]?.confidence ?? null,
              })),
              hasConflict:
                result.kind === 'conflicts' ||
                (result.kind === 'mixed-confirm' && result.conflicts.length > 0),
              hasDirectives: !!(result.parserDirectives?.exclude_row_predicates?.length),
            });
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

  // 4d.2.c — log detected cell-transformation rules once per session.
  useEffect(() => {
    const rules = parserDirectives?.cell_transformations ?? [];
    if (!rules.length || cellRulesDetectedLoggedRef.current) return;
    cellRulesDetectedLoggedRef.current = true;
    void logParserDiagnostic(sessionId, 'ssphase4d2c', 'cell-transformation-detected', {
      rules: rules.map(r => ({
        rule: r.rule,
        level: r.level ?? null,
        delimiter: (r as { delimiter?: string }).delimiter ?? null,
      })),
    });
  }, [parserDirectives, sessionId]);

  // Phase 4b.2 belt-and-braces guard: if any code path ever populates
  // pendingConflicts without switching phase, force the conflict screen
  // rather than silently rendering the legacy mapping UI.
  useEffect(() => {
    if (
      pendingConflicts.length > 0 &&
      phase !== 'level-conflict' &&
      phase !== 'mapping-confirmation' &&
      phase !== 'generating'
    ) {
      console.warn('[ssphase4b] guard: pendingConflicts present but phase=', phase, '— forcing mapping-confirmation');
      setPhase('mapping-confirmation');
    }
  }, [pendingConflicts, phase]);

  // ── Hierarchical dispatch helpers ────────────────────────────────────────

  type HierPerSheet = Record<string, { items: PlanItem[]; personMappings: PersonMapping[]; resolvedLevels: string[]; resolvedColumnIndices?: number[]; parsedSheet?: import('@/utils/spreadsheet-parser').ParsedSheet; classification?: SheetClassification }>;
  type GenericConfirmPreview = {
    itemsBySheet: Record<string, PlanItem[]>;
    personMappings: PersonMapping[];
    levels: PlanLevel[];
    columnMappings: Record<string, ColumnRole>;
    sectionMapping: ElementRole;
    measurementMode: MeasurementMode;
  };
  type DispatchResult =
    | {
        kind: 'completed';
        payload: { items: PlanItem[]; personMappings: PersonMapping[]; levels: PlanLevel[]; sheetNames: string[] };
        perSheet: HierPerSheet;
        sheetNames: string[];
        clsBySheetName: Record<string, SheetClassification>;
        parserDirectives: ParserDirectivesShape | null;
      }
    | {
        kind: 'conflicts';
        conflicts: PendingConflict[];
        perSheet: HierPerSheet;
        sheetNames: string[];
        clsBySheetName: Record<string, SheetClassification>;
        parserDirectives: ParserDirectivesShape | null;
      }
    | {
        kind: 'generic-confirm';
        sheetNames: string[];
        clsBySheetName: Record<string, SheetClassification>;
        parserDirectives: ParserDirectivesShape | null;
        preview: GenericConfirmPreview;
      }
    | {
        kind: 'mixed-confirm';
        sheetNames: string[];
        clsBySheetName: Record<string, SheetClassification>;
        parserDirectives: ParserDirectivesShape | null;
        perSheet: HierPerSheet;
        preview: GenericConfirmPreview;
        conflicts: PendingConflict[];
      }
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
    detection: StructureDetection;
  }): Promise<DispatchResult> {
    console.log('[ssphase4b] ENTERED tryDispatchHierarchical, selectedIndices:', args.selectedIndices, 'sheetCount:', args.parsedSheets.length);
    void logParserDiagnostic(args.sessionId, 'dispatcher', 'entry', {
      selectedIndices: args.selectedIndices,
      sheetCount: args.parsedSheets.length,
    });
    // Phase 4c.1 — reuse the cached classification fetch from mount.
    const cls = await getClassification();
    if (!cls) {
      console.log('[ssphase4b] dispatch: no layout_classification → fallback');
      void logParserDiagnostic(args.sessionId, 'dispatcher', 'dispatch', {
        outcome: 'fallback',
        reason: 'no layout_classification',
      });
      return { kind: 'fallback', reason: 'no layout_classification' };
    }
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

    // Phase 4d.2.a (revised): split selected sheets into hierarchical and
    // generic subsets and route each via its own pipeline. The combined
    // result lands in MappingConfirmation as long as every generic sheet
    // has classifier output; only "no classifier at all" forces fallback.
    const hierSelected = selected.filter(s => s.decision.kind === 'hierarchical' && s.cls);
    const genericSelected = selected.filter(s => s.decision.kind === 'generic');
    const genericWithoutCls = genericSelected.filter(s => !s.cls);

    const clsRecord: Record<string, SheetClassification> = {};
    clsBySheetName.forEach((v, k) => { clsRecord[k] = v; });
    const directives: ParserDirectivesShape | null = cls.parser_directives ?? null;

    if (genericWithoutCls.length > 0 && hierSelected.length === 0) {
      // No actionable classification at all — preserve legacy fallback.
      console.log('[ssphase4b] dispatch: generic w/o classification → fallback');
      void logParserDiagnostic(args.sessionId, 'dispatcher', 'dispatch', {
        outcome: 'fallback',
        reason: 'generic-without-classification',
        perSheet: selected.map(s => ({ sheet: s.sheet.name, kind: s.decision.kind, hasCls: !!s.cls })),
      });
      return { kind: 'fallback', reason: 'generic-without-classification' };
    }

    // ── Hierarchical subset ────────────────────────────────────────────────
    const personSet = new Set<string>();
    const levelNamesUnion: string[] = [];
    const hierSheetNames: string[] = [];
    const perSheet: HierPerSheet = {};
    const conflicts: PendingConflict[] = [];

    for (const s of hierSelected) {
      if (!s.cls) continue;
      if (s.decision.kind === 'hierarchical' && s.decision.lowConfidence) {
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
        : true;
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
        resolvedColumnIndices: result.resolvedColumnIndices,
        parsedSheet: s.sheet,
        classification: s.cls,
      };
      result.resolvedLevels.forEach(name => {
        if (name && !levelNamesUnion.includes(name)) levelNamesUnion.push(name);
      });
      result.personMappings.forEach(p => personSet.add(p.foundName));
      hierSheetNames.push(s.sheet.name);

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

    // ── Generic subset (Pattern A preview) ────────────────────────────────
    let genericPreviewBuilt: GenericConfirmPreview | null = null;
    if (genericSelected.length > 0 && genericWithoutCls.length === 0) {
      const genericIndicesInSelection = args.selectedIndices.filter(idx => {
        const sheet = args.parsedSheets[idx];
        const c = clsBySheetName.get(sheet.name);
        const dec = decideDispatch(c);
        return dec.kind === 'generic';
      });
      const selectedDetections = genericIndicesInSelection
        .map(i => args.detection.sheets[i])
        .filter(Boolean);
      const merged = mergeSheetDetections(selectedDetections);
      const firstSheet = selectedDetections[0];
      const columnMappingsDefault: Record<string, ColumnRole> = {};
      firstSheet?.allColumnHeaders.forEach(col => {
        columnMappingsDefault[col] = getDefaultColumnRole(col);
      });
      const sectionMappingDefault: ElementRole = args.detection.hasStrategyPattern
        ? { type: 'level', depth: 1 }
        : (firstSheet?.sections.some(s => s.headerText) ? { type: 'level', depth: 1 } : { type: 'skip' });

      const firstName = firstSheet?.sheet.name;
      const firstCls = firstName ? clsBySheetName.get(firstName) : undefined;
      const impliedFirst = firstCls?.structure?.implied_levels ?? [];
      const previewLevels: PlanLevel[] = impliedFirst.length > 0
        ? impliedFirst.map((name, i) => ({ id: String(i + 1), name, depth: i + 1 }))
        : (args.detection.hasStrategyPattern ? STRATEGY_LEVELS : DEFAULT_LEVELS.slice(0, 3));

      const measurementMode: MeasurementMode = 'level4';
      const { items, personMappings } = generatePlanItems(merged, {
        selectedSheetIndices: genericIndicesInSelection,
        sectionMapping: sectionMappingDefault,
        columnMappings: columnMappingsDefault,
        levels: previewLevels,
        measurementMode,
      });

      const itemsBySheet: Record<string, PlanItem[]> = {};
      const sheetNamesPreview: string[] = selectedDetections.map(s => s.sheet.name);
      sheetNamesPreview.forEach(n => { itemsBySheet[n] = []; });
      for (const it of items) {
        const sn = (it as PlanItem & { sheetName?: string }).sheetName;
        if (sn && itemsBySheet[sn]) itemsBySheet[sn].push(it);
        else if (sheetNamesPreview[0]) itemsBySheet[sheetNamesPreview[0]].push(it);
      }

      personMappings.forEach(p => personSet.add(p.foundName));

      genericPreviewBuilt = {
        itemsBySheet,
        personMappings,
        levels: previewLevels,
        columnMappings: columnMappingsDefault,
        sectionMapping: sectionMappingDefault,
        measurementMode,
      };
    }

    // ── Compose unified result ────────────────────────────────────────────
    // Stable order: walk original selection so cards render in the order the
    // user picked sheets (mixing hierarchical/generic).
    const orderedSheetNames: string[] = args.selectedIndices
      .map(i => args.parsedSheets[i]?.name)
      .filter((n): n is string => !!n);

    if (hierSelected.length > 0 && genericPreviewBuilt) {
      void logParserDiagnostic(args.sessionId, 'dispatcher', 'dispatch', {
        outcome: 'mixed-confirm',
        hierSheets: hierSheetNames,
        genericSheets: Object.keys(genericPreviewBuilt.itemsBySheet),
      });
      return {
        kind: 'mixed-confirm',
        sheetNames: orderedSheetNames,
        clsBySheetName: clsRecord,
        parserDirectives: directives,
        perSheet,
        preview: genericPreviewBuilt,
        conflicts,
      };
    }

    if (hierSelected.length === 0 && genericPreviewBuilt) {
      void logParserDiagnostic(args.sessionId, 'dispatcher', 'dispatch', {
        outcome: 'generic-confirm',
        sheets: Object.keys(genericPreviewBuilt.itemsBySheet),
      });
      return {
        kind: 'generic-confirm',
        sheetNames: orderedSheetNames,
        clsBySheetName: clsRecord,
        parserDirectives: directives,
        preview: genericPreviewBuilt,
      };
    }

    // Hierarchical-only path.
    if (conflicts.length > 0) {
      return { kind: 'conflicts', conflicts, perSheet, sheetNames: hierSheetNames, clsBySheetName: clsRecord, parserDirectives: directives };
    }

    const allItems: PlanItem[] = hierSheetNames.flatMap(n => perSheet[n]?.items ?? []);
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
      payload: { items: allItems, personMappings, levels: resolvedLevels, sheetNames: hierSheetNames },
      perSheet,
      sheetNames: hierSheetNames,
      clsBySheetName: clsRecord,
      parserDirectives: directives,
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
          resolvedColumnIndices: result.resolvedColumnIndices,
          parsedSheet: conflict.parsedSheet,
          classification: conflict.sheetClassification,
        },
      }));

      // Phase 4d.1: pop the conflict but stay on the confirmation screen.
      // The user must click "Looks good — Continue" to finalize.
      setPendingConflicts(prev => prev.filter(c => c.sheetName !== conflict.sheetName));
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

  // Phase 4d.1.1 — finalize the Pattern A preview without re-parsing.
  const finalizeFromGenericPreview = async () => {
    if (!genericPreview) return;
    const allItems = hierSheetOrder.flatMap(n => genericPreview.itemsBySheet[n] ?? []);
    await persistAndComplete({
      items: allItems,
      personMappings: genericPreview.personMappings,
      levels: genericPreview.levels,
      sheetNames: hierSheetOrder,
    });
  };

  // Phase 4d.2.a — finalize a mixed-confirm view (hierarchical sheets + generic
  // sheets in one selection). Walk the unified sheet order and pull each sheet's
  // items from whichever bucket holds them.
  const finalizeFromMixed = async () => {
    let snapshots: typeof hierResultsBySheet = {};
    let order: string[] = [];
    setHierResultsBySheet(prev => { snapshots = prev; return prev; });
    setHierSheetOrder(prev => { order = prev; return prev; });

    const allItems: PlanItem[] = [];
    const personSet = new Set<string>();
    const levelNamesUnion: string[] = [];

    for (const n of order) {
      const hier = snapshots[n];
      if (hier) {
        allItems.push(...hier.items);
        hier.personMappings.forEach(p => personSet.add(p.foundName));
        hier.resolvedLevels.forEach(name => {
          if (name && !levelNamesUnion.includes(name)) levelNamesUnion.push(name);
        });
        continue;
      }
      const genericItems = genericPreview?.itemsBySheet[n];
      if (genericItems) allItems.push(...genericItems);
    }
    if (genericPreview) {
      genericPreview.personMappings.forEach(p => personSet.add(p.foundName));
      genericPreview.levels.forEach(l => {
        if (l.name && !levelNamesUnion.includes(l.name)) levelNamesUnion.push(l.name);
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

  // ── Phase 4d.2 helpers ──────────────────────────────────────────────────

  /** Re-parse a sheet with current overrides + active cell transformations,
   *  then re-fold the active row predicates on top. Updates hierResultsBySheet
   *  and the predicate baseline for that sheet. */
  function reparseAndRefold(
    sheetName: string,
    nextCellTx: CellTransformation[],
    nextPredicates: string[],
    nextColumnIndices?: number[],
  ) {
    const hier = hierResultsBySheet[sheetName];
    if (!hier?.parsedSheet || !hier?.classification) return;
    const userLevelsForSheet = hier.resolvedLevels;
    const colIndices = nextColumnIndices ?? hier.resolvedColumnIndices;
    const result = parseHierarchicalColumns(
      hier.parsedSheet,
      hier.classification,
      userLevelsForSheet,
      sessionId,
      colIndices,
      nextCellTx,
    );
    // Apply active predicates over the fresh parse output.
    const headers = (() => {
      const hdrIdx = hier.classification.structure?.header_row_index ?? 0;
      const row = hier.parsedSheet.rows?.[hdrIdx];
      return Array.isArray(row) ? row.map(c => (c == null ? '' : String(c).trim())) : [];
    })();
    let foldedItems = result.items;
    for (const p of nextPredicates) {
      const parsed: ParsedPredicate = parsePredicate(p, headers);
      foldedItems = applyPredicate(foldedItems, parsed, headers);
    }
    setHierResultsBySheet(prev => ({
      ...prev,
      [sheetName]: {
        ...hier,
        items: foldedItems,
        personMappings: result.personMappings,
        resolvedLevels: result.resolvedLevels,
        resolvedColumnIndices: result.resolvedColumnIndices,
      },
    }));
    // Refresh predicate baseline to the post-cell-tx parse output.
    setPredicateBaselineBySheet(prev => ({ ...prev, [sheetName]: result.items }));
    return { itemsAfter: foldedItems.length, cellsTransformed: result.cellsTransformed ?? 0 };
  }

  // 4d.2.a — apply column-to-level mapping from LevelMappingInterface.
  const handleApplyLevelMapping = (userLevels: string[], userLevelColumnIndices: number[]) => {
    const target = levelMappingTarget;
    if (!target) return;
    const sheetName = target.sheetName;
    const itemsBefore = hierResultsBySheet[sheetName]?.items.length ?? 0;
    const activeTx = activeCellTxBySheet[sheetName] ?? [];
    const activePreds = activePredicatesBySheet[sheetName] ?? [];
    // Update resolvedLevels then re-parse with new column indices.
    setHierResultsBySheet(prev => ({
      ...prev,
      [sheetName]: { ...prev[sheetName], resolvedLevels: userLevels, resolvedColumnIndices: userLevelColumnIndices },
    }));
    const r = reparseAndRefold(sheetName, activeTx, activePreds, userLevelColumnIndices);
    void logParserDiagnostic(sessionId, 'ssphase4d2a', 'level-mapping-applied', {
      sheet: sheetName,
      userLevels,
      userLevelColumnIndices,
      itemsBefore,
      itemsAfter: r?.itemsAfter ?? 0,
    }, sheetName);
    setLevelMappingTarget(null);
    setPhase('mapping-confirmation');
  };

  // 4d.2.b — apply / undo a row predicate.
  const headersForSheet = (sheetName: string): string[] => {
    const hier = hierResultsBySheet[sheetName];
    if (hier?.parsedSheet && hier?.classification) {
      const hdrIdx = hier.classification.structure?.header_row_index ?? 0;
      const row = hier.parsedSheet.rows?.[hdrIdx];
      return Array.isArray(row) ? row.map(c => (c == null ? '' : String(c).trim())) : [];
    }
    const detSheet = detection?.sheets.find(s => s.sheet.name === sheetName);
    const cls = clsBySheetName[sheetName];
    const hdrIdx = cls?.structure?.header_row_index ?? 0;
    const row = detSheet?.sheet.rows?.[hdrIdx];
    return Array.isArray(row) ? row.map(c => (c == null ? '' : String(c).trim())) : [];
  };

  const recordRemoved = (sheetName: string, predicate: string, removed: number) => {
    setRemovedCountByPredicateBySheet(prev => ({
      ...prev,
      [sheetName]: { ...(prev[sheetName] ?? {}), [predicate]: removed },
    }));
  };

  const handleApplyPredicate = (predicate: string) => {
    // Hierarchical sheets — re-parse + re-fold via existing helper.
    for (const sheetName of hierSheetOrder) {
      const hier = hierResultsBySheet[sheetName];
      if (!hier?.parsedSheet || !hier?.classification) continue;
      if (!predicateBaselineBySheet[sheetName]) {
        setPredicateBaselineBySheet(prev => ({ ...prev, [sheetName]: hier.items }));
      }
      const nextPreds = [...(activePredicatesBySheet[sheetName] ?? []), predicate];
      setActivePredicatesBySheet(prev => ({ ...prev, [sheetName]: nextPreds }));
      const activeTx = activeCellTxBySheet[sheetName] ?? [];
      const itemsBefore = hier.items.length;
      const r = reparseAndRefold(sheetName, activeTx, nextPreds);
      const removed = itemsBefore - (r?.itemsAfter ?? itemsBefore);
      recordRemoved(sheetName, predicate, removed);
      const parsed = parsePredicate(predicate, headersForSheet(sheetName));
      void logParserDiagnostic(sessionId, 'ssphase4d2b', 'predicate-applied', {
        sheet: sheetName, predicate, kind: parsed.kind, mode: 'hier',
        itemsBefore, itemsAfter: r?.itemsAfter ?? 0, removedCount: removed,
        activeCount: nextPreds.length,
      }, sheetName);
    }
    // Generic (Pattern A) sheets — filter from baseline + re-fold.
    if (genericPreview) {
      const sheetNames = Object.keys(genericPreview.itemsBySheet);
      for (const sheetName of sheetNames) {
        const currentItems = genericPreview.itemsBySheet[sheetName] ?? [];
        const baseline = genericPredicateBaselineBySheet[sheetName] ?? currentItems;
        if (!genericPredicateBaselineBySheet[sheetName]) {
          setGenericPredicateBaselineBySheet(prev => ({ ...prev, [sheetName]: currentItems }));
        }
        const nextPreds = [...(activePredicatesBySheet[sheetName] ?? []), predicate];
        setActivePredicatesBySheet(prev => ({ ...prev, [sheetName]: nextPreds }));
        const headers = headersForSheet(sheetName);
        let folded = baseline;
        for (const p of nextPreds) {
          folded = applyPredicate(folded, parsePredicate(p, headers), headers);
        }
        const itemsBefore = currentItems.length;
        const itemsAfter = folded.length;
        setGenericPreview(prev => prev ? ({
          ...prev,
          itemsBySheet: { ...prev.itemsBySheet, [sheetName]: folded },
        }) : prev);
        const removed = baseline.length - itemsAfter;
        recordRemoved(sheetName, predicate, Math.max(0, itemsBefore - itemsAfter));
        const parsed = parsePredicate(predicate, headers);
        void logParserDiagnostic(sessionId, 'ssphase4d2b', 'predicate-applied', {
          sheet: sheetName, predicate, kind: parsed.kind, mode: 'generic',
          itemsBefore, itemsAfter, removedCount: removed,
          activeCount: nextPreds.length,
        }, sheetName);
      }
    }
  };

  const handleUndoPredicate = (predicate: string) => {
    for (const sheetName of hierSheetOrder) {
      const cur = activePredicatesBySheet[sheetName] ?? [];
      if (!cur.includes(predicate)) continue;
      const nextPreds = cur.filter(p => p !== predicate);
      setActivePredicatesBySheet(prev => ({ ...prev, [sheetName]: nextPreds }));
      const activeTx = activeCellTxBySheet[sheetName] ?? [];
      const r = reparseAndRefold(sheetName, activeTx, nextPreds);
      setRemovedCountByPredicateBySheet(prev => {
        const sheetMap = { ...(prev[sheetName] ?? {}) };
        delete sheetMap[predicate];
        return { ...prev, [sheetName]: sheetMap };
      });
      void logParserDiagnostic(sessionId, 'ssphase4d2b', 'predicate-undone', {
        sheet: sheetName, predicate, mode: 'hier',
        itemsAfter: r?.itemsAfter ?? 0, activeCount: nextPreds.length,
      }, sheetName);
    }
    if (genericPreview) {
      const sheetNames = Object.keys(genericPreview.itemsBySheet);
      for (const sheetName of sheetNames) {
        const cur = activePredicatesBySheet[sheetName] ?? [];
        if (!cur.includes(predicate)) continue;
        const nextPreds = cur.filter(p => p !== predicate);
        setActivePredicatesBySheet(prev => ({ ...prev, [sheetName]: nextPreds }));
        const baseline = genericPredicateBaselineBySheet[sheetName]
          ?? genericPreview.itemsBySheet[sheetName] ?? [];
        const headers = headersForSheet(sheetName);
        let folded = baseline;
        for (const p of nextPreds) {
          folded = applyPredicate(folded, parsePredicate(p, headers), headers);
        }
        setGenericPreview(prev => prev ? ({
          ...prev,
          itemsBySheet: { ...prev.itemsBySheet, [sheetName]: folded },
        }) : prev);
        setRemovedCountByPredicateBySheet(prev => {
          const sheetMap = { ...(prev[sheetName] ?? {}) };
          delete sheetMap[predicate];
          return { ...prev, [sheetName]: sheetMap };
        });
        void logParserDiagnostic(sessionId, 'ssphase4d2b', 'predicate-undone', {
          sheet: sheetName, predicate, mode: 'generic',
          itemsAfter: folded.length, activeCount: nextPreds.length,
        }, sheetName);
      }
    }
  };

  // 4d.2.c — apply / undo a cell transformation rule (by key).
  const allCellRules: CellTransformation[] = parserDirectives?.cell_transformations ?? [];
  const handleApplyCellRule = (key: string) => {
    const rule = allCellRules.find(r => cellRuleKey(r) === key);
    if (!rule) return;
    let appliedOnAnySheet = false;
    for (const sheetName of hierSheetOrder) {
      const hier = hierResultsBySheet[sheetName];
      if (!hier?.parsedSheet || !hier?.classification) continue;
      // Hotfix #2: remap classifier-tagged level → user-stated level by ordinal position.
      const classifierLevels = hier.classification.structure?.implied_levels ?? [];
      const effectiveLevels = hier.resolvedLevels ?? [];
      const { remapped, dropped, trace } = remapCellTransformationLevels(
        [rule],
        classifierLevels,
        effectiveLevels,
      );
      void logParserDiagnostic(sessionId, 'ssphase4d2c', 'cell-transformation-remap', {
        sheet: sheetName,
        originalKey: key,
        rule: rule.rule,
        originalLevel: rule.level ?? null,
        classifierLevels,
        effectiveLevels,
        trace,
        dropped,
      }, sheetName);
      if (remapped.length === 0) {
        // Fully dropped on this sheet — record 0 affected.
        setCellsTransformedByRuleSheet(prev => ({
          ...prev,
          [sheetName]: { ...(prev[sheetName] ?? {}), [key]: 0 },
        }));
        continue;
      }
      // Tag the applied rule with its UI key so undo can find it.
      const tagged = remapped.map(r => ({ ...r, __originalKey: key })) as (CellTransformation & { __originalKey?: string })[];
      if (!cellTxBaselineBySheet[sheetName]) {
        setCellTxBaselineBySheet(prev => ({
          ...prev,
          [sheetName]: {
            items: hier.items, personMappings: hier.personMappings,
            resolvedLevels: hier.resolvedLevels, resolvedColumnIndices: hier.resolvedColumnIndices,
          },
        }));
      }
      const cur = activeCellTxBySheet[sheetName] ?? [];
      const nextTx = [...cur, ...tagged];
      setActiveCellTxBySheet(prev => ({ ...prev, [sheetName]: nextTx }));
      const activePreds = activePredicatesBySheet[sheetName] ?? [];
      const itemsBefore = hier.items.length;
      const r = reparseAndRefold(sheetName, nextTx, activePreds);
      const cellsTransformed = r?.cellsTransformed ?? 0;
      setCellsTransformedByRuleSheet(prev => ({
        ...prev,
        [sheetName]: { ...(prev[sheetName] ?? {}), [key]: cellsTransformed },
      }));
      appliedOnAnySheet = true;
      void logParserDiagnostic(sessionId, 'ssphase4d2c', 'cell-transformation-applied', {
        sheet: sheetName, rule: rule.rule,
        originalLevel: rule.level ?? null,
        appliedLevel: tagged[0].level ?? null,
        itemsBefore, itemsAfter: r?.itemsAfter ?? 0, cellsTransformed,
        activeCount: nextTx.length, mode: 'hier',
      }, sheetName);
    }
    if (!appliedOnAnySheet) {
      void logParserDiagnostic(sessionId, 'ssphase4d2c', 'cell-transformation-inapplicable', {
        key, rule: rule.rule, originalLevel: rule.level ?? null,
        reason: 'remap-dropped-on-all-sheets',
      });
    }
  };
  const handleUndoCellRule = (key: string) => {
    for (const sheetName of hierSheetOrder) {
      const cur = activeCellTxBySheet[sheetName] ?? [];
      const nextTx = cur.filter(r => (r as { __originalKey?: string }).__originalKey !== key);
      if (nextTx.length === cur.length) continue;
      setActiveCellTxBySheet(prev => ({ ...prev, [sheetName]: nextTx }));
      const activePreds = activePredicatesBySheet[sheetName] ?? [];
      reparseAndRefold(sheetName, nextTx, activePreds);
      setCellsTransformedByRuleSheet(prev => {
        const sheetMap = { ...(prev[sheetName] ?? {}) };
        delete sheetMap[key];
        return { ...prev, [sheetName]: sheetMap };
      });
      void logParserDiagnostic(sessionId, 'ssphase4d2c', 'cell-transformation-undone', {
        sheet: sheetName, key, activeCount: nextTx.length,
      }, sheetName);
    }
  };
  const handleIgnoreCellRule = (key: string) => {
    setDismissedCellRuleKeys(prev => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    const rule = allCellRules.find(r => cellRuleKey(r) === key);
    void logParserDiagnostic(sessionId, 'ssphase4d2c', 'cell-transformation-ignored', {
      key, rule: rule?.rule ?? null, level: rule?.level ?? null,
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

  if (phase === 'mapping-confirmation') {
    const sheetSummaries: SheetSummary[] = hierSheetOrder.map(name => {
      const cls = clsBySheetName[name];
      const hier = hierResultsBySheet[name];
      const conflict = pendingConflicts.find(c => c.sheetName === name);
      const headerRowIdx = cls?.structure?.header_row_index ?? 0;
      const nameColIdx = cls?.structure?.name_column_index ?? null;
      const detSheet = detection?.sheets.find(s => s.sheet.name === name)?.sheet;
      const parsedSheet = conflict?.parsedSheet ?? detSheet;
      let nameSourceColumn: string | null = null;
      let attributeMappings: AttributeMapping[] = [];
      // Resolved levels: hierarchical run wins; otherwise classifier implied_levels (Pattern A).
      const resolvedLevels: string[] = hier?.resolvedLevels
        ?? (cls?.structure?.implied_levels ?? []);
      if (parsedSheet) {
        const headerRow = parsedSheet.rows?.[headerRowIdx];
        if (Array.isArray(headerRow)) {
          if (nameColIdx != null && nameColIdx >= 0 && nameColIdx < headerRow.length) {
            const v = headerRow[nameColIdx];
            nameSourceColumn = v == null ? null : String(v).trim() || null;
          }
          const resolvedLevelsLower = new Set(resolvedLevels.map(s => s.toLowerCase()));
          headerRow.forEach((cell, idx) => {
            const header = cell == null ? '' : String(cell).trim();
            if (!header) return;
            if (idx === nameColIdx) return;
            if (resolvedLevelsLower.has(header.toLowerCase())) return;
            const role = getDefaultColumnRole(header);
            attributeMappings.push({ header, role, included: role !== 'skip' });
          });
        }
      }
      if (!nameSourceColumn && resolvedLevels.length) {
        nameSourceColumn = resolvedLevels[resolvedLevels.length - 1];
      }
      // Item count: hierarchical run wins; else generic preview bucket.
      const itemCount = hier?.items.length
        ?? genericPreview?.itemsBySheet[name]?.length
        ?? 0;
      return {
        sheetName: name,
        pattern: cls?.pattern ?? '?',
        confidence: typeof cls?.confidence === 'number' ? cls.confidence : null,
        resolvedLevels,
        itemCount,
        nameSourceColumn,
        attributeMappings,
        conflict: conflict
          ? { userLevels: conflict.userLevels, classifierLevels: conflict.classifierLevels }
          : undefined,
      };
    });

    // Build informational directive rows (4d.2.a: Apply UI is gated off).
    const firstHierName = hierSheetOrder.find(n => hierResultsBySheet[n]?.parsedSheet);
    const headersForParse: string[] = (() => {
      if (!firstHierName) return [];
      const hier = hierResultsBySheet[firstHierName];
      const hdrIdx = hier?.classification?.structure?.header_row_index ?? 0;
      const row = hier?.parsedSheet?.rows?.[hdrIdx];
      return Array.isArray(row) ? row.map(c => (c == null ? '' : String(c).trim())) : [];
    })();
    const predicateRows: PredicateRow[] = (parserDirectives?.exclude_row_predicates ?? []).map(p => {
      const activeOnSheets = Object.entries(activePredicatesBySheet)
        .filter(([, preds]) => preds.includes(p))
        .map(([s]) => s);
      const removedCount = activeOnSheets.reduce(
        (n, s) => n + (removedCountByPredicateBySheet[s]?.[p] ?? 0), 0);
      return {
        predicate: p,
        parsed: parsePredicate(p, headersForParse),
        activeOnSheets,
        removedCount,
      };
    });
    const describeCellRule = (t: CellTransformation): string => {
      const lvl = t.level ? ` for level "${t.level}"` : '';
      if (t.rule === 'take-first-delimited') {
        const delim = (t as { delimiter?: string }).delimiter || ',';
        return `Take the first value before "${delim}"${lvl}`;
      }
      if (t.rule === 'resolve-numeric-reference') {
        return `Resolve numeric reference IDs to their full names${lvl}`;
      }
      return `${String((t as { rule: string }).rule)}${lvl}`;
    };
    const cellRuleRows: CellRuleRow[] = (parserDirectives?.cell_transformations ?? []).map(rule => {
      const key = cellRuleKey(rule);
      // Hotfix #4: match by stable __originalKey tag set in handleApplyCellRule,
      // because Hotfix #2 remaps `level` between the source rule and the active
      // rule, so cellRuleKey(r) no longer equals the source key after apply.
      const activeOnSheets = Object.entries(activeCellTxBySheet)
        .filter(([, rules]) =>
          rules.some(r => (r as { __originalKey?: string }).__originalKey === key)
        )
        .map(([s]) => s);
      const cellsTransformed = activeOnSheets.reduce(
        (n, s) => n + (cellsTransformedByRuleSheet[s]?.[key] ?? 0), 0);
      return { rule, description: describeCellRule(rule), activeOnSheets, cellsTransformed };
    });
    const directivesSummary: DirectivesSummary | undefined =
      (predicateRows.length || cellRuleRows.length)
        ? {
            excludePredicates: parserDirectives?.exclude_row_predicates ?? [],
            predicateRows,
            cellRuleRows,
          }
        : undefined;

    const hasHier = Object.keys(hierResultsBySheet).length > 0;
    const hasGeneric = !!genericPreview;
    const mode: 'mixed' | 'generic' | 'hierarchical' = hasHier && hasGeneric
      ? 'mixed'
      : hasGeneric ? 'generic' : 'hierarchical';

    return (
      <MappingConfirmation
        sheetSummaries={sheetSummaries}
        directives={directivesSummary}
        dismissedPredicates={dismissedPredicates}
        dismissedCellRuleKeys={dismissedCellRuleKeys}
        conflictBusy={conflictApplyBusy}
        directivesEnabled={{ predicates: true, cellRules: true }}
        hasHierarchicalSheets={hasHier}
        onApplyPredicate={handleApplyPredicate}
        onUndoPredicate={handleUndoPredicate}
        onApplyCellRule={handleApplyCellRule}
        onUndoCellRule={handleUndoCellRule}
        onIgnoreCellRule={handleIgnoreCellRule}
        onAccept={() => {
          void logParserDiagnostic(sessionId, 'ssphase4d', 'accept-clicked', {
            source: mode,
            sheets: sheetSummaries.map(s => ({ sheet: s.sheetName, items: s.itemCount })),
            totalItems: sheetSummaries.reduce((n, s) => n + s.itemCount, 0),
          });
          if (mode === 'mixed') {
            finalizeFromMixed();
          } else if (mode === 'generic') {
            finalizeFromGenericPreview();
          } else {
            finalizeFromHierSnapshots();
          }
        }}
        onAdjust={(sheetName) => {
          const cls = clsBySheetName[sheetName];
          const pattern = String(cls?.pattern ?? '').toUpperCase();
          const target = (pattern === 'B' || pattern === 'C') ? 'level-mapping' : 'mapping-interface';
          void logParserDiagnostic(sessionId, 'ssphase4d', 'adjust-clicked', {
            sheet: sheetName,
            pattern,
            target,
            levelsSeededFrom: hasGeneric ? 'classifier' : 'defaults',
          });
          if ((pattern === 'B' || pattern === 'C') && cls) {
            const hier = hierResultsBySheet[sheetName];
            const parsedSheet = hier?.parsedSheet ?? detection?.sheets.find(s => s.sheet.name === sheetName)?.sheet;
            if (parsedSheet) {
              const initialLevels = hier?.resolvedLevels ?? cls.structure?.implied_levels ?? [];
              const initialColumnIndices = hier?.resolvedColumnIndices ?? initialLevels.map((_, i) => i);
              setLevelMappingTarget({ sheetName, classification: cls, parsedSheet, initialLevels, initialColumnIndices });
              setPhase('level-mapping');
              return;
            }
          }
          // Pattern A (and any unknown): legacy mapping flow.
          setPendingConflicts([]);
          setPhase('mapping');
        }}
        onApplyConflict={(sheetName, choice) => {
          const c = pendingConflicts.find(pc => pc.sheetName === sheetName);
          if (c) handleApplyLevelChoice(c, choice);
        }}
        onIgnoreDirective={(predicate) => {
          setDismissedPredicates(prev => {
            const next = new Set(prev);
            next.add(predicate);
            return next;
          });
          void logParserDiagnostic(sessionId, 'ssphase4d', 'directive-ignored', { predicate });
        }}
      />
    );
  }

  if (phase === 'level-mapping' && levelMappingTarget) {
    return (
      <LevelMappingInterface
        sheetName={levelMappingTarget.sheetName}
        parsedSheet={levelMappingTarget.parsedSheet}
        classification={levelMappingTarget.classification}
        initialLevels={levelMappingTarget.initialLevels}
        initialColumnIndices={levelMappingTarget.initialColumnIndices}
        cellTransformations={activeCellTxBySheet[levelMappingTarget.sheetName] ?? []}
        sessionId={sessionId}
        onApply={handleApplyLevelMapping}
        onCancel={() => { setLevelMappingTarget(null); setPhase('mapping-confirmation'); }}
      />
    );
  }

  return null;
}
