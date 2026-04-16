import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Upload, ChevronDown, CheckCircle, Plus, Pencil, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { PlanItem } from '@/types/plan';
import { parseReimportFile, ReimportResult } from '@/utils/reimport-parser';
import { calculateDiff, DiffSummary } from '@/utils/reimport-diff';
import { supabase } from '@/integrations/supabase/client';
import { logActivity } from '@/utils/logActivity';
import { toast } from '@/hooks/use-toast';

interface ReimportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentItems: PlanItem[];
  sessionId?: string;
  onApply: (items: PlanItem[]) => void;
}

type DialogState = 'file-select' | 'diff-preview' | 'applying';

export function ReimportDialog({ open, onOpenChange, currentItems, sessionId, onApply }: ReimportDialogProps) {
  const [state, setState] = useState<DialogState>('file-select');
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [diff, setDiff] = useState<DiffSummary | null>(null);
  const [importedItems, setImportedItems] = useState<PlanItem[]>([]);

  const reset = useCallback(() => {
    setState('file-select');
    setError(null);
    setWarnings([]);
    setDiff(null);
    setImportedItems([]);
  }, []);

  const handleOpenChange = (open: boolean) => {
    if (!open) reset();
    onOpenChange(open);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    try {
      const buffer = await file.arrayBuffer();
      const result: ReimportResult = parseReimportFile(buffer);
      setWarnings(result.warnings);
      setImportedItems(result.items);
      const diffResult = calculateDiff(currentItems, result.items);
      setDiff(diffResult);
      setState('diff-preview');
    } catch (err: any) {
      setError(err.message || 'Failed to parse file');
    }
    // Reset input so same file can be re-selected
    e.target.value = '';
  };

  const handleApply = async () => {
    if (!diff) return;
    setState('applying');

    try {
      // Save reimport metadata to step_results
      if (sessionId) {
        const { data: { user } } = await supabase.auth.getUser();
        const { data: currentSession } = await supabase
          .from('processing_sessions')
          .select('step_results')
          .eq('id', sessionId)
          .single();

        const existingResults = (currentSession?.step_results as Record<string, unknown>) || {};

        await supabase.from('processing_sessions').update({
          step_results: {
            ...existingResults,
            reimport: {
              timestamp: new Date().toISOString(),
              userId: user?.id,
              userEmail: user?.email,
              summary: {
                added: diff.added.length,
                removed: diff.removed.length,
                modified: diff.modified.length,
                unchanged: diff.unchanged.length,
                totalImported: diff.totalImported,
                totalBefore: diff.totalCurrent,
              },
              changes: [
                ...diff.added.map(d => ({ type: 'added', name: d.name, order: d.order })),
                ...diff.removed.map(d => ({ type: 'removed', name: d.name, order: d.order })),
                ...diff.modified.map(d => ({ type: 'modified', name: d.name, order: d.order, fields: d.fields })),
              ],
            },
          },
        }).eq('id', sessionId);

        await logActivity('reimport_applied', {
          session_id: sessionId,
          added: diff.added.length,
          removed: diff.removed.length,
          modified: diff.modified.length,
        });
      }

      onApply(importedItems);
      handleOpenChange(false);

      toast({
        title: 'Plan re-imported',
        description: `${diff.added.length} added, ${diff.removed.length} removed, ${diff.modified.length} modified.`,
      });
    } catch (err) {
      console.error('Reimport apply error:', err);
      toast({ title: 'Error applying re-import', description: 'Changes could not be saved.', variant: 'destructive' });
      setState('diff-preview');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {state === 'file-select' && 'Re-Import Plan from Excel'}
            {state === 'diff-preview' && 'Review Changes Before Applying'}
            {state === 'applying' && 'Applying Changes…'}
          </DialogTitle>
          {state === 'file-select' && (
            <DialogDescription>
              Upload an edited version of your exported plan. The file must follow the AchieveIt import template format (18 columns).
            </DialogDescription>
          )}
        </DialogHeader>

        {state === 'file-select' && (
          <div className="space-y-4 py-4">
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-lg p-8 cursor-pointer hover:border-primary/50 transition-colors">
              <Upload className="h-8 w-8 text-muted-foreground mb-2" />
              <span className="text-sm text-muted-foreground">Click to choose an .xlsx or .csv file</span>
              <input type="file" accept=".xlsx,.csv" className="hidden" onChange={handleFileChange} />
            </label>
            {error && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <p>{error}</p>
                  <Button variant="link" size="sm" className="p-0 h-auto mt-1" onClick={() => setError(null)}>Try Again</Button>
                </div>
              </div>
            )}
          </div>
        )}

        {state === 'diff-preview' && diff && (
          <ScrollArea className="flex-1 min-h-0">
            <div className="space-y-4 pr-4">
              {/* Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-md border p-3 text-center">
                  <div className="text-lg font-bold text-muted-foreground">{diff.unchanged.length}</div>
                  <div className="text-xs text-muted-foreground">Unchanged</div>
                </div>
                <div className="rounded-md border border-green-500/30 bg-green-500/5 p-3 text-center">
                  <div className="text-lg font-bold text-green-600">{diff.added.length}</div>
                  <div className="text-xs text-muted-foreground">Added</div>
                </div>
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-center">
                  <div className="text-lg font-bold text-amber-600">{diff.modified.length}</div>
                  <div className="text-xs text-muted-foreground">Modified</div>
                </div>
                <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-center">
                  <div className="text-lg font-bold text-red-600">{diff.removed.length}</div>
                  <div className="text-xs text-muted-foreground">Removed</div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Total imported: {diff.totalImported} items | Current plan: {diff.totalCurrent} items
              </p>

              {warnings.length > 0 && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm space-y-1">
                  <p className="font-medium text-amber-700">Warnings:</p>
                  {warnings.map((w, i) => <p key={i} className="text-xs text-amber-600">{w}</p>)}
                </div>
              )}

              {/* Added */}
              {diff.added.length > 0 && (
                <Collapsible defaultOpen={diff.added.length <= 10}>
                  <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium w-full hover:bg-muted/30 rounded p-2 transition-colors">
                    <ChevronDown className="h-4 w-4" />
                    <Plus className="h-4 w-4 text-green-600" />
                    {diff.added.length} items added
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="pl-8 space-y-1 py-2">
                      {diff.added.map((d, i) => (
                        <p key={i} className="text-sm">
                          <Badge variant="outline" className="mr-2 text-xs">{d.order}</Badge>
                          {d.name}
                        </p>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}

              {/* Removed */}
              {diff.removed.length > 0 && (
                <Collapsible defaultOpen={diff.removed.length <= 10}>
                  <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium w-full hover:bg-muted/30 rounded p-2 transition-colors">
                    <ChevronDown className="h-4 w-4" />
                    <Trash2 className="h-4 w-4 text-red-600" />
                    {diff.removed.length} items removed
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="pl-8 space-y-1 py-2">
                      {diff.removed.map((d, i) => (
                        <p key={i} className="text-sm line-through text-muted-foreground">
                          <Badge variant="outline" className="mr-2 text-xs">{d.order}</Badge>
                          {d.name}
                        </p>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}

              {/* Modified */}
              {diff.modified.length > 0 && (
                <Collapsible defaultOpen={diff.modified.length <= 10}>
                  <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium w-full hover:bg-muted/30 rounded p-2 transition-colors">
                    <ChevronDown className="h-4 w-4" />
                    <Pencil className="h-4 w-4 text-amber-600" />
                    {diff.modified.length} items modified
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="pl-8 space-y-3 py-2">
                      {diff.modified.map((d, i) => (
                        <div key={i}>
                          <p className="text-sm font-medium">
                            "{d.name}" <Badge variant="outline" className="ml-1 text-xs">{d.order}</Badge>
                          </p>
                          {d.fields?.map((f, j) => (
                            <p key={j} className="text-xs text-muted-foreground ml-4">
                              {f.field}: <span className="text-red-500">{f.oldValue}</span> → <span className="text-green-600">{f.newValue}</span>
                            </p>
                          ))}
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          </ScrollArea>
        )}

        {state === 'applying' && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {state === 'diff-preview' && (
          <DialogFooter>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
            <Button onClick={handleApply}>Apply Changes</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
