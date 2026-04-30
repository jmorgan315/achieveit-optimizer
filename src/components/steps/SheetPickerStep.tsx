import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { parseSpreadsheetFile, detectStructure, ParsedSheet, SheetDetection } from '@/utils/spreadsheet-parser';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Loader2,
  AlertTriangle,
  Info,
  ChevronDown,
  FileSpreadsheet,
  ArrowRight,
} from 'lucide-react';

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 120_000;

type SheetPattern = 'A' | 'B' | 'C' | 'D' | 'not_plan_content' | 'empty' | 'unknown';

interface ClassifiedSheet {
  sheet_name: string;
  pattern: SheetPattern;
  confidence?: number;
  reasoning?: string;
  structure?: Record<string, unknown>;
}

interface ParserDirectives {
  exclude_sheets: string[];
  exclude_row_predicates: string[];
  include_only_recent: boolean;
}

interface LayoutClassification {
  workbook_summary?: {
    primary_pattern?: string;
    needs_user_clarification?: boolean;
    clarification_reason?: string;
    clarification_type?:
      | 'time_versioning'
      | 'scope_variation'
      | 'ambiguous_pattern'
      | 'mixed_patterns'
      | 'other';
  };
  parser_directives?: ParserDirectives;
  sheets?: ClassifiedSheet[];
  error?: string;
}

interface SheetPickerStepProps {
  file: File;
  sessionId: string;
  onContinue: (preselectedSheetIndices: number[] | undefined) => void;
}

const PATTERN_LABEL: Record<SheetPattern, string> = {
  A: 'Section blocks',
  B: 'Flat list',
  C: 'Column-nested',
  D: 'Pivot / scorecard',
  not_plan_content: 'Not plan content',
  empty: 'Empty',
  unknown: 'Unclear',
};

const PATTERN_GROUP_ORDER: SheetPattern[] = [
  'A',
  'B',
  'C',
  'D',
  'unknown',
  'not_plan_content',
  'empty',
];

const PLAN_PATTERNS: SheetPattern[] = ['A', 'B', 'C', 'D'];

const CLARIFICATION_LABEL: Record<string, string> = {
  time_versioning: 'Time-versioned sheets',
  scope_variation: 'Scope variations',
  ambiguous_pattern: 'Ambiguous structure',
  mixed_patterns: 'Mixed patterns',
  other: 'Needs your input',
};

export function SheetPickerStep({ file, sessionId, onContinue }: SheetPickerStepProps) {
  const [sheets, setSheets] = useState<ParsedSheet[] | null>(null);
  const [classification, setClassification] = useState<LayoutClassification | null>(null);
  const [classifierFailed, setClassifierFailed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const initSelectedFromClassifier = useRef(false);

  // Parse workbook locally so we have canonical sheet ordering.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const parsed = await parseSpreadsheetFile(file);
        if (cancelled) return;
        setSheets(parsed);
      } catch (e) {
        console.error('[SheetPicker] parse failed:', e);
        if (!cancelled) setParseError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  // Poll classification.
  useEffect(() => {
    let cancelled = false;
    const start = Date.now();

    const poll = async (): Promise<void> => {
      if (cancelled) return;
      const { data, error } = await supabase
        .from('processing_sessions')
        .select('layout_classification')
        .eq('id', sessionId)
        .maybeSingle();

      if (!cancelled && !error && data?.layout_classification) {
        const cls = data.layout_classification as unknown as LayoutClassification;
        if (cls.error) {
          setClassifierFailed(true);
        } else {
          setClassification(cls);
        }
        return;
      }

      if (Date.now() - start > POLL_TIMEOUT_MS) {
        if (!cancelled) setTimedOut(true);
        return;
      }
      setTimeout(poll, POLL_INTERVAL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Map classifier sheet_name → parsed sheet index.
  const sheetIndexByName = useMemo(() => {
    const map = new Map<string, number>();
    sheets?.forEach((s, i) => map.set(s.name, i));
    return map;
  }, [sheets]);

  // Per-sheet structure detection (item counts, sections, columns) for plan-content rows.
  // Wrapped in try/catch so a parser hiccup degrades silently to the lean view.
  const detectionByName = useMemo(() => {
    const map = new Map<string, SheetDetection>();
    if (!sheets) return map;
    try {
      const det = detectStructure(sheets);
      det.sheets.forEach(sd => map.set(sd.sheet.name, sd));
    } catch (e) {
      console.warn('[SheetPicker] detectStructure failed, falling back to lean view:', e);
    }
    return map;
  }, [sheets]);

  // Pre-select plan-content sheets once both parse + classify resolve.
  useEffect(() => {
    if (initSelectedFromClassifier.current) return;
    if (!sheets) return;

    if (classification?.sheets) {
      const initial = new Set<number>();
      for (const s of classification.sheets) {
        if (PLAN_PATTERNS.includes(s.pattern)) {
          const idx = sheetIndexByName.get(s.sheet_name);
          if (idx != null) initial.add(idx);
        }
      }
      // Safety net: if classifier returned nothing usable, pre-select all sheets.
      if (initial.size === 0) sheets.forEach((_, i) => initial.add(i));
      setSelected(initial);
      initSelectedFromClassifier.current = true;
    } else if (classifierFailed || timedOut) {
      // No classifier data — pre-select everything; user will refine downstream.
      const initial = new Set<number>();
      sheets.forEach((_, i) => initial.add(i));
      setSelected(initial);
      initSelectedFromClassifier.current = true;
    }
  }, [sheets, classification, classifierFailed, timedOut, sheetIndexByName]);

  // Group classifier results by pattern for display.
  const grouped = useMemo(() => {
    const groups = new Map<SheetPattern, ClassifiedSheet[]>();
    if (classification?.sheets) {
      for (const s of classification.sheets) {
        const key = (s.pattern || 'unknown') as SheetPattern;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(s);
      }
    }
    return groups;
  }, [classification]);

  const directives = classification?.parser_directives;
  const hasAnyDirective =
    !!directives &&
    ((directives.exclude_sheets && directives.exclude_sheets.length > 0) ||
      (directives.exclude_row_predicates && directives.exclude_row_predicates.length > 0) ||
      directives.include_only_recent === true);

  // Count selected sheets that fall under plan-content patterns (A/B/C/D/unknown).
  // Drives the "duplicates will be merged" helper.
  const selectedPlanSheetCount = useMemo(() => {
    if (!classification?.sheets) return 0;
    let n = 0;
    for (const s of classification.sheets) {
      const idx = sheetIndexByName.get(s.sheet_name);
      if (idx == null) continue;
      const isPlan = PLAN_PATTERNS.includes(s.pattern) || s.pattern === 'unknown';
      if (isPlan && selected.has(idx)) n += 1;
    }
    return n;
  }, [classification, sheetIndexByName, selected]);

  // ---- Render ----

  if (parseError) {
    return (
      <div className="w-full max-w-4xl mx-auto">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Couldn't read the spreadsheet</AlertTitle>
          <AlertDescription>{parseError}</AlertDescription>
        </Alert>
      </div>
    );
  }

  // While parsing OR waiting for classifier, show the analyzing state immediately.
  const stillAnalyzing =
    !sheets || (!classification && !classifierFailed && !timedOut);

  if (stillAnalyzing) {
    return (
      <div className="w-full max-w-4xl mx-auto">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Analyzing workbook structure…</p>
            <p className="text-xs text-muted-foreground">
              We're using AI to identify which sheets contain your plan content.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const toggle = (idx: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const selectAll = () => {
    const next = new Set<number>();
    sheets!.forEach((_, i) => next.add(i));
    setSelected(next);
  };
  const selectNone = () => setSelected(new Set());

  const handleContinue = () => {
    const indices = [...selected].sort((a, b) => a - b);
    // If user picked everything (or classifier was unavailable), pass undefined so the
    // downstream importer falls back to its own default selection logic.
    if (indices.length === sheets!.length) onContinue(undefined);
    else onContinue(indices);
  };

  const showFallbackBanner = classifierFailed || timedOut;

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Confirm the sheets to import
          </CardTitle>
          <CardDescription>
            We've analyzed your workbook. Review the sheets we plan to import below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {showFallbackBanner && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>AI analysis unavailable</AlertTitle>
              <AlertDescription>
                We couldn't analyze the structure automatically. All sheets are pre-selected;
                you can refine in the next step.
              </AlertDescription>
            </Alert>
          )}

          {classification?.workbook_summary?.needs_user_clarification && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>
                {CLARIFICATION_LABEL[classification.workbook_summary.clarification_type || 'other']}
              </AlertTitle>
              <AlertDescription>
                {classification.workbook_summary.clarification_reason ||
                  'This workbook needs your input on which sheets to import.'}
              </AlertDescription>
            </Alert>
          )}

          {hasAnyDirective && (
            <Collapsible defaultOpen>
              <Card className="border-dashed">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full flex items-center justify-between p-4 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <Info className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">
                        Suggestions from your notes
                      </span>
                      <Badge variant="secondary" className="ml-2">
                        Default: Ignore
                      </Badge>
                    </div>
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 pb-4 space-y-3 text-sm">
                    <p className="text-muted-foreground">
                      We parsed these instructions from the notes you provided. They are{' '}
                      <strong>not</strong> applied automatically. Review and apply manually if needed.
                    </p>

                    {directives!.exclude_sheets.length > 0 && (
                      <div>
                        <div className="font-medium">Sheets you asked to skip</div>
                        <ul className="list-disc list-inside text-muted-foreground">
                          {directives!.exclude_sheets.map(s => (
                            <li key={s}>{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {directives!.exclude_row_predicates.length > 0 && (
                      <div>
                        <div className="font-medium">Row filters you mentioned</div>
                        <ul className="list-disc list-inside text-muted-foreground">
                          {directives!.exclude_row_predicates.map(p => (
                            <li key={p}>{p}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {directives!.include_only_recent && (
                      <div>
                        <div className="font-medium">Scope</div>
                        <p className="text-muted-foreground">
                          You asked to include only the most-recent version.
                        </p>
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}

          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {selected.size} of {sheets!.length} sheets selected
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={selectAll}>
                Select all
              </Button>
              <Button variant="ghost" size="sm" onClick={selectNone}>
                Clear
              </Button>
            </div>
          </div>

          {classification?.sheets ? (
            <div className="space-y-4">
              {PATTERN_GROUP_ORDER.map(pattern => {
                const items = grouped.get(pattern);
                if (!items || items.length === 0) return null;
                return (
                  <div key={pattern} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={PLAN_PATTERNS.includes(pattern) ? 'default' : 'outline'}>
                        {PATTERN_LABEL[pattern]}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {items.length} sheet{items.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {items.map(s => {
                        const idx = sheetIndexByName.get(s.sheet_name);
                        if (idx == null) return null;
                        const isChecked = selected.has(idx);
                        return (
                          <label
                            key={`${pattern}-${s.sheet_name}`}
                            className="flex items-start gap-3 p-3 rounded-md border hover:bg-muted/40 cursor-pointer"
                          >
                            <Checkbox
                              checked={isChecked}
                              onCheckedChange={() => toggle(idx)}
                              className="mt-0.5"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <div className="font-medium truncate">{s.sheet_name}</div>
                                {typeof s.confidence === 'number' && (
                                  <span className="text-xs text-muted-foreground shrink-0">
                                    {Math.round(s.confidence)}% confidence
                                  </span>
                                )}
                              </div>
                              {s.reasoning && (
                                <div className="text-xs text-muted-foreground mt-0.5">
                                  {s.reasoning}
                                </div>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            // Fallback: no classifier data — show plain sheet list.
            <div className="space-y-1">
              {sheets!.map((s, idx) => {
                const isChecked = selected.has(idx);
                return (
                  <label
                    key={s.name}
                    className="flex items-center gap-3 p-3 rounded-md border hover:bg-muted/40 cursor-pointer"
                  >
                    <Checkbox checked={isChecked} onCheckedChange={() => toggle(idx)} />
                    <div className="font-medium truncate">{s.name}</div>
                  </label>
                );
              })}
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button onClick={handleContinue} disabled={selected.size === 0}>
              Continue
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
