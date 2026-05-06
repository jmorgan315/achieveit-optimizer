/**
 * Phase 4d.1 / 4d.2.b / 4d.2.c — Mapping confirmation screen.
 *
 * Renders classifier analysis per dispatched sheet plus AI directives
 * (row predicates, cell-level transformations). Apply/Undo on directives
 * round-trips back through the parent so the parser can re-fold the active
 * set on every mutation.
 *
 * No filename / sheet-name / column-string heuristics — every label and
 * count is derived from runtime parser/classifier output.
 */

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CheckCircle2, AlertTriangle, Sparkles, Settings2, Undo2 } from 'lucide-react';
import { ColumnRole } from '@/utils/spreadsheet-parser';
import { LevelConflictBlock, LevelChoice } from '@/components/spreadsheet/MappingInterface';
import { ParsedPredicate } from '@/utils/parsers/applyRowPredicate';
import { CellTransformation } from '@/utils/parsers/parseHierarchicalColumns';

export interface AttributeMapping {
  header: string;
  role: ColumnRole;
  included: boolean;
}

export interface ConfirmationConflict {
  userLevels: string[];
  classifierLevels: string[];
}

export interface SheetSummary {
  sheetName: string;
  pattern: string;
  confidence: number | null;
  resolvedLevels: string[];
  itemCount: number;
  nameSourceColumn: string | null;
  attributeMappings: AttributeMapping[];
  conflict?: ConfirmationConflict;
}

export interface PredicateRow {
  predicate: string;
  parsed: ParsedPredicate;
  // Per-sheet apply state: which sheets currently have this predicate active.
  activeOnSheets: string[];
  // Pre-apply count → total removed across active sheets.
  removedCount: number;
}

export interface CellRuleRow {
  rule: CellTransformation;
  description: string;
  activeOnSheets: string[];
  cellsTransformed: number;
}

export interface DirectivesSummary {
  excludePredicates: string[];
  predicateRows?: PredicateRow[];
  cellRuleRows?: CellRuleRow[];
}

interface MappingConfirmationProps {
  sheetSummaries: SheetSummary[];
  directives?: DirectivesSummary;
  dismissedPredicates: Set<string>;
  dismissedCellRuleKeys?: Set<string>;
  conflictBusy: boolean;
  /** Phase 4d.2.a: directive Apply UI is gated. Defaults to all-disabled. */
  directivesEnabled?: { predicates: boolean; cellRules: boolean };
  onAccept: () => void;
  onAdjust: (sheetName: string) => void;
  onApplyConflict: (sheetName: string, choice: LevelChoice) => void;
  onIgnoreDirective: (predicate: string) => void;
  onApplyPredicate?: (predicate: string) => void;
  onUndoPredicate?: (predicate: string) => void;
  onApplyCellRule?: (ruleKey: string) => void;
  onUndoCellRule?: (ruleKey: string) => void;
  onIgnoreCellRule?: (ruleKey: string) => void;
}

const COLUMN_ROLE_LABEL: Record<ColumnRole, string> = {
  item_name: 'Item Name',
  owner: 'Assigned To',
  date: 'Date / Deadline',
  metric: 'Metric / Measurement',
  member: 'Member',
  description: 'Description',
  tag: 'Tag',
  skip: 'Skip',
};

function patternBadgeVariant(pattern: string): { label: string; className: string } {
  const p = String(pattern || '').toUpperCase();
  if (p === 'A') return { label: 'Pattern A', className: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300' };
  if (p === 'B') return { label: 'Pattern B', className: 'bg-sky-500/15 text-sky-700 border-sky-500/30 dark:text-sky-300' };
  if (p === 'C') return { label: 'Pattern C', className: 'bg-violet-500/15 text-violet-700 border-violet-500/30 dark:text-violet-300' };
  if (p === 'D') return { label: 'Pattern D', className: 'bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300' };
  return { label: `Pattern ${p || '?'}`, className: 'bg-muted text-foreground/70 border-border' };
}

export function cellRuleKey(t: CellTransformation): string {
  const lvl = t.level || '*';
  const delim = (t as { delimiter?: string }).delimiter || '';
  return `${t.rule}|${lvl}|${delim}`;
}

export function MappingConfirmation({
  sheetSummaries,
  directives,
  dismissedPredicates,
  dismissedCellRuleKeys,
  conflictBusy,
  onAccept,
  onAdjust,
  onApplyConflict,
  onIgnoreDirective,
  onApplyPredicate,
  onUndoPredicate,
  onApplyCellRule,
  onUndoCellRule,
  onIgnoreCellRule,
}: MappingConfirmationProps) {
  const hasUnresolvedConflict = useMemo(
    () => sheetSummaries.some(s => !!s.conflict),
    [sheetSummaries],
  );
  const totalItems = useMemo(
    () => sheetSummaries.reduce((sum, s) => sum + (s.itemCount || 0), 0),
    [sheetSummaries],
  );

  const predicateRows = directives?.predicateRows ?? [];
  const cellRuleRows = directives?.cellRuleRows ?? [];
  const dismissedRules = dismissedCellRuleKeys ?? new Set<string>();
  const showDirectivesCard = predicateRows.length > 0 || cellRuleRows.length > 0;

  return (
    <TooltipProvider>
      <div className="w-full max-w-4xl mx-auto space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">Review the AI's analysis</h2>
          <p className="text-xs text-muted-foreground">
            {sheetSummaries.length} sheet{sheetSummaries.length === 1 ? '' : 's'} · {totalItems} item{totalItems === 1 ? '' : 's'}
          </p>
        </div>

        {showDirectivesCard && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Suggestions from your notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {predicateRows.length > 0 && (
                <div className="space-y-3">
                  {predicateRows.map(row => {
                    const dismissed = dismissedPredicates.has(row.predicate);
                    const active = row.activeOnSheets.length > 0;
                    const tooComplex = row.parsed.kind === 'too-complex';
                    return (
                      <div key={row.predicate} className="flex items-start justify-between gap-3 text-sm border rounded-md p-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">AI noted you want to exclude rows where:</div>
                          <div className="text-muted-foreground break-words">{row.predicate}</div>
                          {active && (
                            <div className="text-xs text-emerald-600 mt-1">
                              ✓ Applied — removed {row.removedCount} row{row.removedCount === 1 ? '' : 's'}
                            </div>
                          )}
                          {dismissed && !active && (
                            <div className="text-xs text-muted-foreground mt-1 italic">Ignored — these rows will be included.</div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {active ? (
                            <Button size="sm" variant="outline" onClick={() => onUndoPredicate?.(row.predicate)}>
                              <Undo2 className="h-3.5 w-3.5 mr-1" /> Undo
                            </Button>
                          ) : tooComplex ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <Button size="sm" variant="outline" disabled>
                                    Apply this filter
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                This rule is too complex to apply automatically.
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => onApplyPredicate?.(row.predicate)}>
                              Apply this filter
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant={dismissed ? 'secondary' : 'ghost'}
                            onClick={() => onIgnoreDirective(row.predicate)}
                            disabled={dismissed || active}
                          >
                            Ignore
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {cellRuleRows.length > 0 && (
                <div className="space-y-3">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cell rules</div>
                  {cellRuleRows.map(row => {
                    const key = cellRuleKey(row.rule);
                    const active = row.activeOnSheets.length > 0;
                    const dismissed = dismissedRules.has(key);
                    return (
                      <div key={key} className="flex items-start justify-between gap-3 text-sm border rounded-md p-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">AI suggested cell rule:</div>
                          <div className="text-muted-foreground break-words">{row.description}</div>
                          {active && (
                            <div className="text-xs text-emerald-600 mt-1">
                              ✓ Applied — transformed {row.cellsTransformed} cell{row.cellsTransformed === 1 ? '' : 's'}
                            </div>
                          )}
                          {dismissed && !active && (
                            <div className="text-xs text-muted-foreground mt-1 italic">Ignored.</div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {active ? (
                            <Button size="sm" variant="outline" onClick={() => onUndoCellRule?.(key)}>
                              <Undo2 className="h-3.5 w-3.5 mr-1" /> Undo
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => onApplyCellRule?.(key)}>
                              Apply this rule
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant={dismissed ? 'secondary' : 'ghost'}
                            onClick={() => onIgnoreCellRule?.(key)}
                            disabled={dismissed || active}
                          >
                            Ignore
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {sheetSummaries.map(summary => {
          const badge = patternBadgeVariant(summary.pattern);
          const lowConfidence = typeof summary.confidence === 'number' && summary.confidence < 80;
          return (
            <div key={summary.sheetName} className="space-y-3">
              {lowConfidence && (
                <Alert className="border-amber-500/50 bg-amber-500/5">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertTitle>AI is less certain about this sheet</AlertTitle>
                  <AlertDescription>
                    Please review the analysis carefully before continuing.
                  </AlertDescription>
                </Alert>
              )}

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                    <Sparkles className="h-4 w-4 text-primary" />
                    AI Analysis
                    <Badge variant="outline" className="font-normal">{summary.sheetName}</Badge>
                    <Badge className={`font-normal ${badge.className}`} variant="outline">{badge.label}</Badge>
                    {typeof summary.confidence === 'number' && (
                      <span className="text-xs text-muted-foreground font-normal">
                        {Math.round(summary.confidence)}% confidence
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  {summary.resolvedLevels.length > 0 && (
                    <div>
                      <div className="font-medium mb-1">Detected levels</div>
                      <div className="text-muted-foreground pl-2">
                        {summary.resolvedLevels.join(' → ')}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{summary.itemCount} item{summary.itemCount === 1 ? '' : 's'} extracted</Badge>
                    {summary.nameSourceColumn && (
                      <span className="text-xs text-muted-foreground">
                        Item name from column "{summary.nameSourceColumn}"
                      </span>
                    )}
                  </div>

                  {summary.attributeMappings.length > 0 && (
                    <div>
                      <div className="font-medium mb-1">Other columns</div>
                      <ul className="space-y-0.5 pl-2">
                        {summary.attributeMappings.map(m => (
                          <li key={m.header} className="flex items-center gap-2 text-sm">
                            <span className={m.included ? 'text-emerald-600' : 'text-muted-foreground'}>
                              {m.included ? '✓' : '·'}
                            </span>
                            <span className="truncate">{m.header}</span>
                            <span className="text-xs text-muted-foreground ml-auto shrink-0">
                              → {COLUMN_ROLE_LABEL[m.role]}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>

              {summary.conflict && (
                <LevelConflictBlock
                  sheetName={summary.sheetName}
                  userLevels={summary.conflict.userLevels}
                  classifierLevels={summary.conflict.classifierLevels}
                  busy={conflictBusy}
                  onApply={(choice) => onApplyConflict(summary.sheetName, choice)}
                />
              )}
            </div>
          );
        })}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => onAdjust(sheetSummaries[0]?.sheetName ?? '')}
            disabled={sheetSummaries.length === 0}
          >
            <Settings2 className="h-4 w-4 mr-2" />
            Let me adjust
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  onClick={onAccept}
                  disabled={hasUnresolvedConflict || sheetSummaries.length === 0}
                  className="bg-emerald-600 hover:bg-emerald-600/90 text-white"
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Looks good — Continue
                </Button>
              </span>
            </TooltipTrigger>
            {hasUnresolvedConflict && (
              <TooltipContent>
                Resolve the level conflict above to continue.
              </TooltipContent>
            )}
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
