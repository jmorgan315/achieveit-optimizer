import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { ChevronDown, Copy, ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import type { Json } from '@/integrations/supabase/types';

interface Session {
  id: string;
  created_at: string;
  org_name: string | null;
  org_industry: string | null;
  document_name: string | null;
  document_size_bytes: number | null;
  extraction_method: string | null;
  total_items_extracted: number | null;
  total_api_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_duration_ms: number;
  status: string;
}

interface ApiLog {
  id: string;
  created_at: string;
  edge_function: string;
  step_label: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  duration_ms: number | null;
  status: string | null;
  error_message: string | null;
  request_payload: Json;
  response_payload: Json;
}

function renderMessages(payload: Json) {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, Json>;
  const messages = p.messages as Array<Record<string, Json>> | undefined;
  if (!messages?.length) return null;

  return (
    <div className="space-y-3">
      {p.system && (
        <div className="rounded border border-border p-3 bg-muted/30">
          <p className="text-xs font-medium text-muted-foreground mb-1">System Prompt</p>
          <p className="text-sm whitespace-pre-wrap">{String(p.system)}</p>
        </div>
      )}
      {messages.map((msg, i) => (
        <div key={i} className="rounded border border-border p-3">
          <p className="text-xs font-medium text-muted-foreground mb-1 capitalize">{String(msg.role || 'unknown')}</p>
          {typeof msg.content === 'string' ? (
            <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
          ) : Array.isArray(msg.content) ? (
            <div className="space-y-2">
              {(msg.content as Array<Record<string, Json>>).map((block, j) => {
                if (block.type === 'text') return <p key={j} className="text-sm whitespace-pre-wrap">{String(block.text)}</p>;
                if (block.type === 'image') {
                  const src = block.source as Record<string, string> | undefined;
                  const data = src?.data || '';
                  return <Badge key={j} variant="outline">[Image: {data.includes('TRUNCATED') ? data : `${(data.length * 0.75 / 1024).toFixed(0)} KB`}]</Badge>;
                }
                return <pre key={j} className="text-xs">{JSON.stringify(block, null, 2)}</pre>;
              })}
            </div>
          ) : (
            <pre className="text-xs">{JSON.stringify(msg.content, null, 2)}</pre>
          )}
        </div>
      ))}
    </div>
  );
}

function renderResponseContent(payload: Json) {
  if (!payload || typeof payload !== 'object') return <p className="text-sm text-muted-foreground">No response data</p>;
  const p = payload as Record<string, Json>;

  // Anthropic format
  const content = p.content as Array<Record<string, Json>> | undefined;
  if (Array.isArray(content)) {
    return (
      <div className="space-y-2">
        {content.map((block, i) => {
          if (block.type === 'text') return <p key={i} className="text-sm whitespace-pre-wrap">{String(block.text)}</p>;
          if (block.type === 'tool_use') return (
            <div key={i} className="rounded border border-border p-3 bg-muted/30">
              <p className="text-xs font-medium text-muted-foreground mb-1">Tool: {String(block.name)}</p>
              <pre className="text-xs overflow-auto">{JSON.stringify(block.input, null, 2)}</pre>
            </div>
          );
          return <pre key={i} className="text-xs">{JSON.stringify(block, null, 2)}</pre>;
        })}
      </div>
    );
  }

  // OpenAI format
  const choices = p.choices as Array<Record<string, Json>> | undefined;
  if (Array.isArray(choices) && choices.length > 0) {
    const msg = choices[0].message as Record<string, Json> | undefined;
    if (msg?.content) return <p className="text-sm whitespace-pre-wrap">{String(msg.content)}</p>;
  }

  return <pre className="text-xs overflow-auto">{JSON.stringify(payload, null, 2)}</pre>;
}

function CopyButton({ text }: { text: string }) {
  const { toast } = useToast();
  return (
    <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard.writeText(text); toast({ title: 'Copied' }); }}>
      <Copy className="h-3.5 w-3.5 mr-1" /> Copy
    </Button>
  );
}

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [logs, setLogs] = useState<ApiLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [{ data: s }, { data: l }] = await Promise.all([
        supabase.from('processing_sessions').select('*').eq('id', id).single(),
        supabase.from('api_call_logs').select('*').eq('session_id', id).order('created_at', { ascending: true }),
      ]);
      setSession(s);
      setLogs((l || []) as ApiLog[]);
      setLoading(false);
    })();
  }, [id]);

  if (loading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!session) return <div className="p-6 text-muted-foreground">Session not found</div>;

  const statusVariant = session.status === 'completed' ? 'default' : session.status === 'failed' ? 'destructive' : 'secondary';

  return (
    <div className="p-6 space-y-6">
      <Link to="/admin/sessions" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Sessions
      </Link>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{session.org_name || 'Unknown Org'}</CardTitle>
            <Badge variant={statusVariant}>{session.status}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><span className="text-muted-foreground">Industry:</span> {session.org_industry || '—'}</div>
            <div><span className="text-muted-foreground">Document:</span> {session.document_name || '—'}</div>
            <div><span className="text-muted-foreground">Method:</span> <Badge variant="outline">{session.extraction_method || '—'}</Badge></div>
            <div><span className="text-muted-foreground">Date:</span> {format(new Date(session.created_at), 'MMM d, yyyy HH:mm')}</div>
            <div><span className="text-muted-foreground">Items:</span> {session.total_items_extracted ?? '—'}</div>
            <div><span className="text-muted-foreground">API Calls:</span> {session.total_api_calls}</div>
            <div><span className="text-muted-foreground">Tokens:</span> {session.total_input_tokens.toLocaleString()} in / {session.total_output_tokens.toLocaleString()} out</div>
            <div><span className="text-muted-foreground">Duration:</span> {(session.total_duration_ms / 1000).toFixed(1)}s</div>
          </div>
        </CardContent>
      </Card>

      <h2 className="text-lg font-semibold">API Call Timeline ({logs.length})</h2>

      <div className="space-y-2">
        {logs.map((log) => (
          <Collapsible key={log.id}>
            <Card>
              <CollapsibleTrigger className="w-full">
                <div className="flex items-center gap-3 p-4 text-sm hover:bg-muted/30 transition-colors">
                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-medium">{log.step_label || log.edge_function}</span>
                  <Badge variant="outline" className="text-xs">{log.edge_function}</Badge>
                  {log.model && <span className="text-xs text-muted-foreground">{log.model}</span>}
                  <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                    {log.input_tokens != null && <span>{log.input_tokens.toLocaleString()} in</span>}
                    {log.output_tokens != null && <span>{log.output_tokens.toLocaleString()} out</span>}
                    {log.duration_ms != null && <span>{(log.duration_ms / 1000).toFixed(1)}s</span>}
                    <Badge variant={log.status === 'success' ? 'default' : 'destructive'} className="text-xs">{log.status}</Badge>
                  </span>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t border-border p-4">
                  {log.error_message && (
                    <p className="text-sm text-destructive mb-3">Error: {log.error_message}</p>
                  )}
                  <Tabs defaultValue="request">
                    <TabsList>
                      <TabsTrigger value="request">Request</TabsTrigger>
                      <TabsTrigger value="response">Response</TabsTrigger>
                      <TabsTrigger value="raw">Raw JSON</TabsTrigger>
                    </TabsList>
                    <TabsContent value="request">
                      <ScrollArea className="max-h-[500px]">
                        {renderMessages(log.request_payload)}
                      </ScrollArea>
                    </TabsContent>
                    <TabsContent value="response">
                      <ScrollArea className="max-h-[500px]">
                        {renderResponseContent(log.response_payload)}
                      </ScrollArea>
                    </TabsContent>
                    <TabsContent value="raw">
                      <div className="space-y-2">
                        <div className="flex justify-end"><CopyButton text={JSON.stringify({ request: log.request_payload, response: log.response_payload }, null, 2)} /></div>
                        <ScrollArea className="max-h-[500px]">
                          <pre className="text-xs bg-muted/30 rounded p-3 overflow-auto">{JSON.stringify({ request: log.request_payload, response: log.response_payload }, null, 2)}</pre>
                        </ScrollArea>
                      </div>
                    </TabsContent>
                  </Tabs>
                </div>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        ))}
        {logs.length === 0 && <p className="text-sm text-muted-foreground">No API calls logged for this session.</p>}
      </div>
    </div>
  );
}
