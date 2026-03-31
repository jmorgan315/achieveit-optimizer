import { useState, useEffect } from 'react';
import { PlanItem } from '@/types/plan';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight, FileText, Clock, Cpu, Layers } from 'lucide-react';

interface SessionSummaryCardProps {
  sessionId?: string;
  items: PlanItem[];
}

interface SessionData {
  document_name: string | null;
  extraction_method: string | null;
  total_items_extracted: number | null;
  total_duration_ms: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

export function SessionSummaryCard({ sessionId, items }: SessionSummaryCardProps) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<SessionData | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    supabase
      .from('processing_sessions')
      .select('document_name, extraction_method, total_items_extracted, total_duration_ms, total_input_tokens, total_output_tokens')
      .eq('id', sessionId)
      .single()
      .then(({ data }) => {
        if (data) setSession(data);
      });
  }, [sessionId]);

  // Derive agent stats from corrections
  const agent1Count = items.length;
  const auditAdded = items.filter(i => i.corrections?.some(c => /added by|missing from|auditor|audit|agent\s*2/i.test(c))).length;
  const auditRephrased = items.filter(i => i.corrections?.some(c => /rephras/i.test(c))).length;
  const validationCorrected = items.filter(i => i.corrections?.some(c => /hierarchy|validator|validation|agent\s*3|parent changed|level changed/i.test(c))).length;

  const avgConfidence = items.length > 0
    ? Math.round(items.reduce((acc, i) => acc + (i.confidence ?? 100), 0) / items.length)
    : 100;

  const totalTokens = session ? session.total_input_tokens + session.total_output_tokens : 0;
  const durationSec = session ? (session.total_duration_ms / 1000).toFixed(1) : '—';

  if (!sessionId) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Cpu className="h-4 w-4 text-muted-foreground" />
                Processing Summary
              </CardTitle>
              <div className="flex items-center gap-2">
                {session?.document_name && (
                  <Badge variant="outline" className="text-xs font-normal">
                    <FileText className="h-3 w-3 mr-1" />
                    {session.document_name}
                  </Badge>
                )}
                {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 pb-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Extraction</p>
                <p className="font-medium capitalize">{session?.extraction_method || 'text'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Pipeline</p>
                <p className="font-medium flex items-center gap-1">
                  <Layers className="h-3 w-3" />
                  {session?.extraction_method === 'spreadsheet'
                    ? 'Direct Import (no AI)'
                    : '4-Agent (Classify → Extract → Audit → Validate)'}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Processing Time</p>
                <p className="font-medium flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {durationSec}s
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Tokens</p>
                <p className="font-medium">{totalTokens.toLocaleString()}</p>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Items</p>
                <p className="font-medium">{agent1Count}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Audit Results</p>
                <p className="font-medium">{auditAdded} missing, {auditRephrased} rephrased</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Validation Fixes</p>
                <p className="font-medium">{validationCorrected} items</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Overall Confidence</p>
                <p className="font-medium">{avgConfidence}%</p>
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
