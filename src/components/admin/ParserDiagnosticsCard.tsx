import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, Copy } from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import type { Json } from '@/integrations/supabase/types';

interface ParserDiagnosticRow {
  id: string;
  created_at: string;
  sheet_name: string | null;
  parser_name: string;
  log_type: string;
  payload: Json;
}

interface Props {
  sessionId: string;
}

export function ParserDiagnosticsCard({ sessionId }: Props) {
  const [rows, setRows] = useState<ParserDiagnosticRow[] | null>(null);
  const [open, setOpen] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('parser_diagnostics')
        .select('id, created_at, sheet_name, parser_name, log_type, payload')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });
      if (cancelled) return;
      if (error) {
        console.error('Failed to load parser diagnostics:', error);
        setRows([]);
        return;
      }
      setRows((data || []) as ParserDiagnosticRow[]);
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  const copyJson = async (payload: Json) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      toast({ title: 'Copied', description: 'Payload copied to clipboard.' });
    } catch (err) {
      toast({ title: 'Copy failed', variant: 'destructive' });
    }
  };

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader>
          <CollapsibleTrigger className="flex w-full items-center justify-between">
            <CardTitle className="text-base">
              Parser Diagnostics
              {rows && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  ({rows.length} {rows.length === 1 ? 'entry' : 'entries'})
                </span>
              )}
            </CardTitle>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-3">
            {rows === null && (
              <div className="text-sm text-muted-foreground">Loading…</div>
            )}
            {rows && rows.length === 0 && (
              <div className="text-sm text-muted-foreground">
                No parser diagnostics for this session.
              </div>
            )}
            {rows && rows.map(row => (
              <div
                key={row.id}
                className="rounded-md border bg-muted/30 p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 flex-wrap text-xs">
                    <Badge variant="outline">{row.parser_name}</Badge>
                    <Badge variant="secondary">{row.log_type}</Badge>
                    {row.sheet_name && (
                      <Badge variant="outline" className="font-normal">
                        {row.sheet_name}
                      </Badge>
                    )}
                    <span className="text-muted-foreground">
                      {format(new Date(row.created_at), 'HH:mm:ss.SSS')}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => copyJson(row.payload)}
                  >
                    <Copy className="h-3 w-3 mr-1" />
                    Copy JSON
                  </Button>
                </div>
                <pre className="text-xs bg-background border rounded p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
{JSON.stringify(row.payload, null, 2)}
                </pre>
              </div>
            ))}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
