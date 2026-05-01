/**
 * Phase 4d.1 — Mapping confirmation screen.
 *
 * Renders the classifier's analysis for each successfully-dispatched sheet
 * and lets the user accept ("Looks good — Continue") or escape to the
 * legacy MappingInterface ("Let me adjust"). When a level conflict is
 * pending, the existing LevelConflictBlock renders inline and Continue is
 * gated until every conflict is resolved.
 *
 * No filename / sheet-name / column-string heuristics. Everything renders
 * from runtime parser output, classifier output, or the existing
 * `getDefaultColumnRole` helper.
 */

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CheckCircle2, AlertTriangle, Sparkles, Settings2 } from 'lucide-react';
import { ColumnRole } from '@/utils/spreadsheet-parser';
import { LevelConflictBlock, LevelChoice } from '@/components/spreadsheet/MappingInterface';

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

export interface DirectivesSummary {
  excludePredicates: string[];
}

interface MappingConfirmationProps {
  sheetSummaries: SheetSummary[];
  directives?: DirectivesSummary;
  dismissedPredicates: Set<string>;
  conflictBusy: boolean;
  onAccept: () => void;
  onAdjust: (sheetName: string) => void;
  onApplyConflict: (sheetName: string, choice: LevelChoice) => void;
  onIgnoreDirective: (predicate: string) => void;
  onAttemptApplyDirective: (predicate: string) => void;
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
  // Mirrors the picker color scheme without hardcoding to file-specific patterns.
  if (p === 'A') return { label: 'Pattern A', className: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300' };
  if (p === 'B') return { label: 'Pattern B', className: 'bg-sky-500/15 text-sky-700 border-sky-500/30 dark:text-sky-300' };
  if (p === 'C') return { label: 'Pattern C', className: 'bg-violet-500/15 text-violet-700 border-violet-500/30 dark:text-violet-300' };
  if (p === 'D') return { label: 'Pattern D', className: 'bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300' };
  return { label: `Pattern ${p || '?'}`, className: 'bg-muted text-foreground/70 border-border' };
}

export function MappingConfirmation({
  sheetSummaries,
  directives,
  dismissedPredicates,
  conflictBusy,
  onAccept,
  onAdjust,
  onApplyConflict,
  onIgnoreDirective,
  onAttemptApplyDirective,
}: MappingConfirmationProps) {
  const hasUnresolvedConflict = useMemo(
    () => sheetSummaries.some(s => !!s.conflict),
    [sheetSummaries],
  );
  const totalItems = useMemo(
    () => sheetSummaries.reduce((sum, s) => sum + (s.itemCount || 0), 0),
    [sheetSummaries],
  );

  const visiblePredicates = (directives?.excludePredicates ?? []).filter(p => p && p.trim().length > 0);

  return (
    <TooltipProvider>
      <div className="w-full max-w-4xl mx-auto space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">Review the AI's analysis</h2>
          <p className="text-xs text-muted-foreground">
            {sheetSummaries.length} sheet{sheetSummaries.length === 1 ? '' : 's'} · {totalItems} item{totalItems === 1 ? '' : 's'}
          </p>
        </div>

        {visiblePredicates.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Suggestions from your notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {visiblePredicates.map(predicate => {
                const dismissed = dismissedPredicates.has(predicate);
                return (
                  <div key={predicate} className="flex items-start justify-between gap-3 text-sm border rounded-md p-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">AI noted you want to exclude rows where:</div>
                      <div className="text-muted-foreground break-words">{predicate}</div>
                      {dismissed && (
                        <div className="text-xs text-muted-foreground mt-1 italic">Ignored — these rows will be included.</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled
                              onClick={() => onAttemptApplyDirective(predicate)}
                            >
                              Apply this filter
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          Coming soon — applying directives lands in the next sub-phase (4d.2).
                        </TooltipContent>
                      </Tooltip>
                      <Button
                        size="sm"
                        variant={dismissed ? 'secondary' : 'ghost'}
                        onClick={() => onIgnoreDirective(predicate)}
                        disabled={dismissed}
                      >
                        Ignore
                      </Button>
                    </div>
                  </div>
                );
              })}
              <p className="text-xs text-muted-foreground">
                Some directive types can't be auto-applied yet. We're working on it.
              </p>
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
