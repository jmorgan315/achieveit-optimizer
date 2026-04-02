import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Building2, CheckCircle2, XCircle, Globe, Layers, FileText,
  Plus, Trash2, Clock, ArrowRight, Info, ArrowUp,
} from 'lucide-react';
import { OrgProfile } from '@/types/plan';
import { LookupResult } from '@/components/steps/OrgProfileStep';
import { Alert, AlertDescription } from '@/components/ui/alert';

export interface ProcessingConfig {
  orgProfile: OrgProfile;
  planLevels: string[];
  pageRanges: Array<{ start: number; end: number }> | null;
  additionalNotes: string;
}

interface ScanResultsStepProps {
  lookupResult: LookupResult | null;
  classificationResult: Record<string, unknown> | null;
  pageCount: number | null;
  scanErrors: Record<string, string>;
  orgName: string;
  industry: string;
  onStartProcessing: (config: ProcessingConfig) => void;
  onBack: () => void;
}

// --- Helpers ---

function pagesToRangeString(pages: number[]): string {
  if (!pages.length) return '';
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0], end = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) {
      end = sorted[i];
    } else {
      ranges.push(start === end ? `${start}` : `${start}-${end}`);
      start = end = sorted[i];
    }
  }
  ranges.push(start === end ? `${start}` : `${start}-${end}`);
  return ranges.join(', ');
}

export function parsePageRanges(
  input: string,
  maxPage: number,
): Array<{ start: number; end: number }> | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(',').map(p => p.trim()).filter(Boolean);
  const ranges: Array<{ start: number; end: number }> = [];

  for (const part of parts) {
    if (part.includes('-')) {
      const [s, e] = part.split('-').map(v => parseInt(v.trim(), 10));
      if (isNaN(s) || isNaN(e) || s < 1 || e < 1 || s > maxPage || e > maxPage || s > e) {
        throw new Error(`Invalid range: ${part}`);
      }
      ranges.push({ start: s, end: e });
    } else {
      const n = parseInt(part, 10);
      if (isNaN(n) || n < 1 || n > maxPage) {
        throw new Error(`Invalid page number: ${part}`);
      }
      ranges.push({ start: n, end: n });
    }
  }
  return ranges;
}

function countPagesInRanges(ranges: Array<{ start: number; end: number }> | null, totalPages: number): number {
  if (!ranges) return totalPages;
  return ranges.reduce((sum, r) => sum + (r.end - r.start + 1), 0);
}

function getDetectedLevelsFromClassification(result: Record<string, unknown> | null): string[] {
  if (!result) return [];
  const hp = result.hierarchy_pattern as Record<string, unknown> | undefined;
  if (!hp) return [];
  const levels = (hp.detected_levels ?? hp.level_names) as string[] | undefined;
  return Array.isArray(levels) ? levels.filter(l => typeof l === 'string' && l.trim()) : [];
}

function getContentPages(result: Record<string, unknown> | null): number[] {
  if (!result) return [];
  const pages = result.plan_content_pages as number[] | undefined;
  return Array.isArray(pages) ? pages.filter(p => typeof p === 'number') : [];
}

function getDocumentType(result: Record<string, unknown> | null): string {
  if (!result) return 'unknown';
  return (result.document_type as string) ?? 'unknown';
}

// --- Component ---

export function ScanResultsStep({
  lookupResult,
  classificationResult,
  pageCount,
  scanErrors,
  orgName,
  industry,
  onStartProcessing,
  onBack,
}: ScanResultsStepProps) {
  // Section 1: Org match
  const [orgConfirmed, setOrgConfirmed] = useState<boolean | null>(null);

  // Section 2: Plan structure
  const detectedLevels = useMemo(
    () => getDetectedLevelsFromClassification(classificationResult),
    [classificationResult],
  );
  const [knowsLevels, setKnowsLevels] = useState(detectedLevels.length > 0);
  const [levelNames, setLevelNames] = useState<string[]>(
    detectedLevels.length > 0 ? detectedLevels : ['Strategic Priority', 'Objective', 'Goal'],
  );

  // Section 3: Document scope
  const contentPages = useMemo(() => getContentPages(classificationResult), [classificationResult]);
  const [scopeInput, setScopeInput] = useState(pagesToRangeString(contentPages));
  const [scopeError, setScopeError] = useState<string | null>(null);

  // Section 5: Notes
  const [additionalNotes, setAdditionalNotes] = useState('');

  // Derived
  const docType = useMemo(() => getDocumentType(classificationResult), [classificationResult]);
  const showOrgMatch = lookupResult !== null && orgConfirmed === null;
  const orgReady = lookupResult === null || orgConfirmed !== null;

  // Parse scope for time estimate
  const parsedRanges = useMemo(() => {
    if (!pageCount) return null;
    try {
      return parsePageRanges(scopeInput, pageCount);
    } catch {
      return null;
    }
  }, [scopeInput, pageCount]);

  const scopePageCount = pageCount ? countPagesInRanges(parsedRanges, pageCount) : 0;

  // Time estimate
  const timeEstimate = useMemo(() => {
    if (!scopePageCount) return null;
    const ratePerPage = docType.includes('presentation') || docType.includes('tabular') ? 4 : docType.includes('text') ? 3 : 3.5;
    const baseSec = scopePageCount * ratePerPage + 30;
    const estimatedItems = scopePageCount * 2;
    const batchOverhead = estimatedItems > 75 ? 15 : 0;
    const totalSec = baseSec + batchOverhead;
    const minMin = Math.max(1, Math.floor((totalSec * 0.8) / 60));
    const maxMin = Math.ceil((totalSec * 1.2) / 60);
    return minMin === maxMin ? `~${minMin} minute${minMin > 1 ? 's' : ''}` : `~${minMin}-${maxMin} minutes`;
  }, [scopePageCount, docType]);

  // Level management
  const updateLevelName = (idx: number, name: string) => {
    const updated = [...levelNames];
    updated[idx] = name;
    setLevelNames(updated);
  };

  const addLevel = () => {
    if (levelNames.length >= 7) return;
    setLevelNames([...levelNames, '']);
  };

  const removeLevel = (idx: number) => {
    if (levelNames.length <= 1) return;
    setLevelNames(levelNames.filter((_, i) => i !== idx));
  };

  // Scope validation
  const validateScope = (value: string) => {
    setScopeInput(value);
    setScopeError(null);
    if (!value.trim() || !pageCount) return;
    try {
      parsePageRanges(value, pageCount);
    } catch (e: unknown) {
      setScopeError((e as Error).message);
    }
  };

  // Submit
  const handleStartProcessing = () => {
    const profile: OrgProfile = {
      organizationName: (orgConfirmed && lookupResult?.name) || orgName.trim(),
      industry,
      website: orgConfirmed ? lookupResult?.website : undefined,
      summary: orgConfirmed ? lookupResult?.summary : undefined,
      confirmed: true,
    };

    const planLevels = knowsLevels
      ? levelNames.map(n => n.trim()).filter(Boolean)
      : [];

    let pageRanges: Array<{ start: number; end: number }> | null = null;
    if (pageCount && scopeInput.trim()) {
      try {
        pageRanges = parsePageRanges(scopeInput, pageCount);
      } catch {
        // already validated on blur, but fallback to null
      }
    }

    onStartProcessing({
      orgProfile: profile,
      planLevels,
      pageRanges,
      additionalNotes: additionalNotes.trim(),
    });
  };

  const canStart = orgReady && !scopeError;
  const showOrgHint = lookupResult !== null && orgConfirmed === null;

  // Left column content
  const leftColumn = (
    <>
      {/* Organization Match */}
      {showOrgMatch && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              Is this your organization?
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 space-y-1.5">
              <h3 className="font-semibold">{lookupResult!.name}</h3>
              {lookupResult!.website && (
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <Globe className="h-3 w-3" />
                  {lookupResult!.website}
                </p>
              )}
              <p className="text-sm">{lookupResult!.summary}</p>
              <p className="text-xs text-muted-foreground mt-1">Industry: {industry}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setOrgConfirmed(true)} className="flex-1">
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
                Yes, correct
              </Button>
              <Button size="sm" variant="outline" onClick={() => setOrgConfirmed(false)}>
                <XCircle className="h-4 w-4 mr-1.5" />
                No
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {orgConfirmed === true && lookupResult && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-3 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
            <div>
              <p className="font-medium">{lookupResult.name}</p>
              <p className="text-sm text-muted-foreground">{industry}{lookupResult.website ? ` • ${lookupResult.website}` : ''}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {orgConfirmed === false && (
        <Alert>
          <Building2 className="h-4 w-4" />
          <AlertDescription>
            Proceeding with manually entered organization: <strong>{orgName}</strong> ({industry})
          </AlertDescription>
        </Alert>
      )}

      {/* Plan Structure */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4 text-primary" />
            Plan Structure
          </CardTitle>
          <CardDescription className="text-sm">
            {detectedLevels.length > 0
              ? `AI detected ${detectedLevels.length} hierarchy levels. Customize below.`
              : 'Define hierarchy levels, or let AI detect them automatically.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="knowsLevels"
              checked={knowsLevels}
              onCheckedChange={(checked) => setKnowsLevels(!!checked)}
            />
            <Label htmlFor="knowsLevels" className="text-sm font-normal cursor-pointer">
              I know my plan's hierarchy levels
            </Label>
          </div>

          {knowsLevels && (
            <div className="space-y-2 pl-6 border-l-2 border-primary/20">
              <div className="space-y-1.5">
                {levelNames.map((name, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-24 flex-shrink-0">
                      Level {idx + 1}{idx === 0 ? ' (highest)' : idx === levelNames.length - 1 ? ' (lowest)' : ''}:
                    </span>
                    <Input
                      value={name}
                      onChange={(e) => updateLevelName(idx, e.target.value)}
                      placeholder={`Level ${idx + 1}`}
                      className="h-8 text-sm"
                    />
                    {levelNames.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeLevel(idx)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              {levelNames.length < 7 && (
                <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={addLevel}>
                  <Plus className="h-3 w-3" />
                  Add Level
                </Button>
              )}
            </div>
          )}

          {!knowsLevels && (
            <p className="text-sm text-muted-foreground pl-6">
              AI will automatically detect hierarchy levels during processing.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );

  // Right column content
  const rightColumn = (
    <>
      {/* Document Scope */}
      {pageCount !== null && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-primary" />
              Document Scope
            </CardTitle>
            <CardDescription className="text-sm">
              {pageCount} page{pageCount !== 1 ? 's' : ''}. Specify which pages contain your plan.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="space-y-1.5">
              <Label htmlFor="scopeInput" className="text-sm">Page ranges</Label>
              <Input
                id="scopeInput"
                value={scopeInput}
                onChange={(e) => validateScope(e.target.value)}
                placeholder="e.g., 1-10, 15-20, 25-50"
                className={`text-sm ${scopeError ? 'border-destructive' : ''}`}
              />
              {scopeError && (
                <p className="text-xs text-destructive">{scopeError}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Leave blank to process the entire document.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Time Estimate */}
      {timeEstimate && (
        <Card className="bg-muted/50">
          <CardContent className="py-3 flex items-center gap-3">
            <Clock className="h-5 w-5 text-muted-foreground shrink-0" />
            <div>
              <p className="text-sm font-medium">Estimated processing time: {timeEstimate}</p>
              <p className="text-xs text-muted-foreground">
                Processing {scopePageCount} page{scopePageCount !== 1 ? 's' : ''} • {docType.replace(/_/g, ' ')} document
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Additional Notes */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="h-4 w-4 text-primary" />
            Additional Notes
            <span className="text-xs font-normal text-muted-foreground">(optional)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={additionalNotes}
            onChange={(e) => setAdditionalNotes(e.target.value)}
            placeholder="Any other context about your document (e.g., 'ignore the appendix', 'metrics are in a separate table on page 30')"
            rows={2}
            className="text-sm"
          />
        </CardContent>
      </Card>
    </>
  );

  return (
    <div className="w-full max-w-5xl mx-auto space-y-4">
      <div className="text-center space-y-1">
        <h2 className="text-2xl font-bold">Review & Configure</h2>
        <p className="text-muted-foreground">
          Confirm your organization and adjust settings before processing.
        </p>
      </div>

      {/* Two-column grid on wide screens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-4">{leftColumn}</div>
        <div className="space-y-4">{rightColumn}</div>
      </div>

      {/* Scan errors */}
      {Object.keys(scanErrors).length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            Some scan operations had issues: {Object.values(scanErrors).join('; ')}. You can still proceed.
          </AlertDescription>
        </Alert>
      )}

      {/* Inline hint when button is disabled due to org confirmation */}
      {showOrgHint && (
        <p className="text-sm text-muted-foreground text-center flex items-center justify-center gap-1.5">
          <ArrowUp className="h-3.5 w-3.5" />
          Please confirm your organization above to continue
        </p>
      )}

      {/* Start Processing button */}
      <Button
        size="lg"
        className="w-full"
        disabled={!canStart}
        onClick={handleStartProcessing}
      >
        Start Processing
        <ArrowRight className="h-4 w-4 ml-2" />
      </Button>
    </div>
  );
}
