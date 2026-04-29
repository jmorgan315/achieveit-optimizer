import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronDown, Copy, ArrowLeft, Download } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import type { Json } from '@/integrations/supabase/types';
import { ResultsPreviewTree } from '@/components/admin/ResultsPreviewTree';

import { useModelRates, type ModelRates } from '@/hooks/useModelRates';

function calcCost(model: string | null, inputTokens: number | null, outputTokens: number | null, rates: ModelRates): number | null {
  if (!model || inputTokens == null || outputTokens == null) return null;
  const r = rates[model];
  if (!r) return null;
  return (inputTokens * r.input + outputTokens * r.output) / 1_000_000;
}

interface Session {
  id: string;
  created_at: string;
  user_id: string | null;
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
  document_type: string | null;
  classification_result: Json;
  step_results: Json;
  source_file_path: string | null;
  layout_classification: Json;
  layout_classified_at: string | null;
}

interface UserProfile {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
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
              <pre className="text-xs whitespace-pre overflow-x-auto">{JSON.stringify(block.input, null, 2)}</pre>
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

  return <pre className="text-xs whitespace-pre overflow-x-auto">{JSON.stringify(payload, null, 2)}</pre>;
}

function ClassificationCard({ classification }: { classification: Record<string, Json> }) {
  const [expanded, setExpanded] = useState(false);
  const docType = String(classification.document_type || 'unknown');
  const confidence = classification.confidence as number | undefined;
  const contentPages = classification.plan_content_pages as number[] | undefined;
  const hierarchy = classification.hierarchy_pattern as Record<string, Json> | undefined;
  const detectedLevels = hierarchy?.detected_levels as string[] | undefined;

  return (
    <Collapsible>
      <Card>
        <CollapsibleTrigger className="w-full [&[data-state=open]_svg.chevron-caret]:rotate-180">
          <div className="flex items-center gap-3 p-4 text-sm hover:bg-muted/30 transition-colors">
            <ChevronDown className="chevron-caret h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200" />
            <span className="font-semibold">Document Classification</span>
            <Badge variant="outline">{docType}</Badge>
            {confidence != null && <span className="text-xs text-muted-foreground">{Math.round(confidence * 100)}% confidence</span>}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border p-4 space-y-3 text-sm">
            {contentPages && contentPages.length > 0 && (
              <div>
                <span className="text-muted-foreground">Plan content pages: </span>
                <span>{contentPages.join(', ')}</span>
              </div>
            )}
            {detectedLevels && detectedLevels.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-muted-foreground">Hierarchy: </span>
                {detectedLevels.map((l, i) => (
                  <Badge key={i} variant="secondary" className="text-xs">{l}</Badge>
                ))}
              </div>
            )}
            <Collapsible open={expanded} onOpenChange={setExpanded}>
              <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                Full Classification JSON
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mt-2 text-xs bg-muted/30 rounded p-3 whitespace-pre overflow-x-auto max-h-[400px] overflow-y-auto">
                  {JSON.stringify(classification, null, 2)}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function LayoutClassificationCard({
  classification,
  logs,
  rates,
}: {
  classification: Record<string, Json>;
  logs: ApiLog[];
  rates: ModelRates;
}) {
  const [expanded, setExpanded] = useState(false);

  // Sentinel error case
  if (classification.error && !classification.sheets) {
    return (
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Layout Classification — Error</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <div className="text-destructive">{String(classification.error)}</div>
          <div className="text-xs text-muted-foreground">
            Model: {String(classification.model || '—')} · {classification.classified_at ? format(new Date(String(classification.classified_at)), 'MMM d, yyyy HH:mm') : '—'}
          </div>
        </CardContent>
      </Card>
    );
  }

  const summary = (classification.workbook_summary as Record<string, Json> | undefined) || {};
  const sheets = (classification.sheets as Array<Record<string, Json>> | undefined) || [];
  const model = String(classification.model || 'claude-sonnet-4-6');

  // Cost from logs
  const layoutLogs = logs.filter(l => l.step_label === 'classify_layout');
  const totalIn = layoutLogs.reduce((a, l) => a + (l.input_tokens || 0), 0);
  const totalOut = layoutLogs.reduce((a, l) => a + (l.output_tokens || 0), 0);
  const totalDur = layoutLogs.reduce((a, l) => a + (l.duration_ms || 0), 0);
  const costs = layoutLogs.map(l => calcCost(l.model, l.input_tokens, l.output_tokens, rates) || 0);
  const totalCost = costs.reduce((a, b) => a + b, 0);

  const patternColor = (p: string) => {
    if (p === 'A' || p === 'B' || p === 'C' || p === 'D') return 'default';
    if (p === 'not_plan_content') return 'secondary';
    return 'outline';
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base">Layout Classification</CardTitle>
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="default">Pattern {String(summary.primary_pattern || '?')}</Badge>
            {summary.needs_user_clarification === true && (
              <Badge variant="destructive">Needs clarification</Badge>
            )}
            <span className="text-muted-foreground">{model}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {summary.clarification_reason ? (
          <div className="rounded border border-border bg-muted/30 p-3 text-xs">
            <span className="font-medium">Why clarification: </span>{String(summary.clarification_reason)}
          </div>
        ) : null}

        {sheets.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Sheet</th>
                  <th className="py-2 pr-3 font-medium">Pattern</th>
                  <th className="py-2 pr-3 font-medium">Conf.</th>
                  <th className="py-2 pr-3 font-medium">Hierarchy signal</th>
                  <th className="py-2 pr-3 font-medium">Implied levels</th>
                  <th className="py-2 pr-3 font-medium">Header / Data / Name</th>
                  <th className="py-2 font-medium">Reasoning</th>
                </tr>
              </thead>
              <tbody>
                {sheets.map((s, i) => {
                  const struct = (s.structure as Record<string, Json> | undefined) || {};
                  const levels = (struct.implied_levels as string[] | undefined) || [];
                  const pattern = String(s.pattern || '?');
                  return (
                    <tr key={i} className="border-b border-border/50 align-top">
                      <td className="py-2 pr-3 font-mono">{String(s.sheet_name || '—')}</td>
                      <td className="py-2 pr-3"><Badge variant={patternColor(pattern) as any} className="text-xs">{pattern}</Badge></td>
                      <td className="py-2 pr-3">{s.confidence != null ? String(s.confidence) : '—'}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{struct.hierarchy_signal ? String(struct.hierarchy_signal) : '—'}</td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap gap-1">
                          {levels.length > 0
                            ? levels.map((l, j) => <Badge key={j} variant="secondary" className="text-xs">{l}</Badge>)
                            : <span className="text-muted-foreground">—</span>}
                        </div>
                      </td>
                      <td className="py-2 pr-3 font-mono text-muted-foreground">
                        {struct.header_row_index != null ? String(struct.header_row_index) : '—'}
                        {' / '}
                        {struct.data_starts_at_row != null ? String(struct.data_starts_at_row) : '—'}
                        {' / '}
                        {struct.name_column_index != null ? String(struct.name_column_index) : '—'}
                      </td>
                      <td className="py-2 max-w-md">{String(s.reasoning || '—')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center gap-4 text-xs text-muted-foreground border-t border-border pt-3">
          <span>{layoutLogs.length} call{layoutLogs.length === 1 ? '' : 's'}</span>
          <span>Tokens: {totalIn.toLocaleString()} in / {totalOut.toLocaleString()} out</span>
          <span>Duration: {(totalDur / 1000).toFixed(1)}s</span>
          <span>Cost: {totalCost > 0 ? `$${totalCost.toFixed(4)}` : '—'}</span>
          {classification.classified_at && (
            <span>Classified: {format(new Date(String(classification.classified_at)), 'MMM d, HH:mm')}</span>
          )}
        </div>

        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
            <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            Full layout_classification JSON
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-2 text-xs bg-muted/30 rounded p-3 whitespace-pre overflow-x-auto max-h-[400px] overflow-y-auto">
              {JSON.stringify(classification, null, 2)}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

function CopyButton({ text }: { text: string }) {
  const { toast } = useToast();
  return (
    <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard.writeText(text); toast({ title: 'Copied' }); }}>
      <Copy className="h-3.5 w-3.5 mr-1" /> Copy
    </Button>
  );
}

function FeedbackSection({ sessionId }: { sessionId: string }) {
  const [feedback, setFeedback] = useState<any>(null);
  const [fbLoading, setFbLoading] = useState(true);
  const [submitter, setSubmitter] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('session_feedback')
        .select('*')
        .eq('session_id', sessionId);
      if (data && data.length > 0) {
        setFeedback(data[0]);
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('email, first_name, last_name')
          .eq('id', data[0].user_id)
          .single();
        if (profile) {
          const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ');
          setSubmitter(name ? `${profile.email} (${name})` : profile.email);
        }
      }
      setFbLoading(false);
    })();
  }, [sessionId]);

  if (fbLoading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">User Feedback</CardTitle>
      </CardHeader>
      <CardContent>
        {!feedback ? (
          <p className="text-sm text-muted-foreground">No feedback submitted.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Expected Items:</span> {feedback.expected_item_count ?? '—'}
            </div>
            <div>
              <span className="text-muted-foreground">Actual Items:</span> {feedback.actual_item_count}
            </div>
            <div>
              <span className="text-muted-foreground">Delta:</span>{' '}
              <Badge variant="secondary">
                {feedback.item_count_delta != null ? (feedback.item_count_delta > 0 ? '+' : '') + feedback.item_count_delta : '—'}
              </Badge>
            </div>
            <div>
              <span className="text-muted-foreground">Hierarchy Rating:</span> {feedback.hierarchy_rating ?? '—'}/5
            </div>
            <div>
              <span className="text-muted-foreground">Overall Rating:</span> {feedback.overall_rating ?? '—'}/5
            </div>
            <div>
              <span className="text-muted-foreground">Time Saved:</span> {feedback.time_saved ?? '—'}
            </div>
            {feedback.open_feedback && (
              <div className="col-span-full">
                <span className="text-muted-foreground">Feedback:</span>
                <p className="mt-1">{feedback.open_feedback}</p>
              </div>
            )}
            <div className="col-span-full text-xs text-muted-foreground">
              Submitted by {submitter ?? 'Unknown'} on {format(new Date(feedback.created_at), 'MMM d, yyyy HH:mm')}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SessionDetailPage() {
  const { rates: modelRates } = useModelRates();
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [session, setSession] = useState<Session | null>(null);
  const [logs, setLogs] = useState<ApiLog[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [{ data: s }, { data: l }, { data: u }] = await Promise.all([
        supabase.from('processing_sessions').select('*').eq('id', id).single(),
        supabase.from('api_call_logs').select('*').eq('session_id', id).order('created_at', { ascending: true }),
        supabase.from('user_profiles').select('id, email, first_name, last_name').eq('is_active', true),
      ]);
      setSession(s);
      setLogs((l || []) as ApiLog[]);
      setUsers((u || []) as UserProfile[]);
      setLoading(false);
    })();
  }, [id]);

  const handleAssignUser = async (userId: string) => {
    if (!session) return;
    setAssigning(true);
    const newUserId = userId === '__unassigned__' ? null : userId;
    const { error } = await supabase.from('processing_sessions').update({ user_id: newUserId }).eq('id', session.id);
    if (error) {
      toast({ title: 'Failed to assign user', description: error.message, variant: 'destructive' });
    } else {
      setSession({ ...session, user_id: newUserId });
      toast({ title: 'User updated' });
    }
    setAssigning(false);
  };

  const handleDownloadSource = async () => {
    if (!session?.source_file_path) return;
    const { data, error } = await supabase.storage
      .from('source-documents')
      .createSignedUrl(session.source_file_path, 300);
    if (error || !data?.signedUrl) {
      toast({ title: 'Failed to generate download link', description: error?.message, variant: 'destructive' });
      return;
    }
    window.open(data.signedUrl, '_blank');
  };

  const assignedUser = users.find(u => u.id === session?.user_id);
  const userDisplayName = (u: UserProfile) => {
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
    return name ? `${u.email} (${name})` : u.email || u.id;
  };

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
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-lg">{session.org_name || 'Unknown Org'}</CardTitle>
            <div className="flex items-center gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDownloadSource}
                        disabled={!session.source_file_path}
                      >
                        <Download className="h-3.5 w-3.5 mr-1.5" />
                        Source Document
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {session.source_file_path
                      ? 'Download original uploaded file'
                      : 'No source document stored (legacy session)'}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Badge variant={statusVariant}>{session.status}</Badge>
            </div>
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
            {(() => {
              const totalCost = logs.reduce((sum, log) => sum + (calcCost(log.model, log.input_tokens, log.output_tokens, modelRates) ?? 0), 0);
              return totalCost > 0 ? <div><span className="text-muted-foreground">Cost:</span> ${totalCost.toFixed(2)}</div> : null;
            })()}
          </div>
          <div className="flex items-center gap-3 mt-4 pt-4 border-t border-border text-sm">
            <span className="text-muted-foreground">User:</span>
            <Select
              value={session.user_id || '__unassigned__'}
              onValueChange={handleAssignUser}
              disabled={assigning}
            >
              <SelectTrigger className="w-[320px] h-8 text-sm">
                <SelectValue>
                  {assignedUser ? userDisplayName(assignedUser) : 'Unassigned'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__unassigned__">Unassigned</SelectItem>
                {users.map(u => (
                  <SelectItem key={u.id} value={u.id}>
                    {userDisplayName(u)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Document Classification */}
      {session.classification_result && typeof session.classification_result === 'object' && (
        <ClassificationCard classification={session.classification_result as Record<string, Json>} />
      )}

      {/* Spreadsheet Import Details */}
      {session.extraction_method === 'spreadsheet' && session.step_results && (() => {
        const sr = session.step_results as Record<string, any>;
        const mappingConfig = sr.mappingConfig as Record<string, any> | undefined;
        const sheetsProcessed = sr.sheetsProcessed as string[] | undefined;
        const totalItems = sr.totalItems as number | undefined;
        return (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Spreadsheet Import Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {totalItems != null && (
                <div><span className="text-muted-foreground">Total items:</span> {totalItems}</div>
              )}
              {sheetsProcessed && sheetsProcessed.length > 0 && (
                <div>
                  <span className="text-muted-foreground">Sheets processed:</span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {sheetsProcessed.map((s, i) => <Badge key={i} variant="secondary" className="text-xs">{s}</Badge>)}
                  </div>
                </div>
              )}
              {mappingConfig?.columnMappings && (
                <div>
                  <span className="text-muted-foreground">Column mappings:</span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {Object.entries(mappingConfig.columnMappings as Record<string, string>).filter(([, v]) => v !== 'skip').map(([col, role], i) => (
                      <Badge key={i} variant="outline" className="text-xs">{col} → {role}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* Re-import History */}
      {(() => {
        const sr = session.step_results as Record<string, any> | null;
        const reimport = sr?.reimport as Record<string, any> | undefined;
        if (!reimport) return null;
        const summary = reimport.summary as Record<string, number> | undefined;
        const changes = reimport.changes as Array<Record<string, any>> | undefined;
        return (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Re-import History</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Re-imported on {format(new Date(reimport.timestamp), 'MMM d, yyyy HH:mm')} by {reimport.userEmail || 'Unknown'}
              </p>
              {summary && (
                <div className="flex flex-wrap gap-3">
                  <Badge variant="secondary">+{summary.added} added</Badge>
                  <Badge variant="secondary">{summary.removed} removed</Badge>
                  <Badge variant="secondary">{summary.modified} modified</Badge>
                  <Badge variant="outline">{summary.unchanged} unchanged</Badge>
                </div>
              )}
              {changes && changes.length > 0 && (
                <Collapsible>
                  <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 [&[data-state=open]_svg.chevron-caret]:rotate-180">
                    <ChevronDown className="chevron-caret h-3 w-3 transition-transform duration-200" /> View Details ({changes.length} changes)
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <ScrollArea className="max-h-[300px] mt-2">
                      <div className="space-y-1 text-xs">
                        {changes.map((c: any, i: number) => (
                          <div key={i} className="flex items-center gap-2">
                            <Badge variant={c.type === 'added' ? 'default' : c.type === 'removed' ? 'destructive' : 'secondary'} className="text-xs w-16 justify-center">
                              {c.type}
                            </Badge>
                            <span>{c.order && `(${c.order}) `}{c.name}</span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </CardContent>
          </Card>
        );
      })()}

      <h2 className="text-lg font-semibold">API Call Timeline ({logs.length})</h2>

      <div className="space-y-2">
        {logs.map((log) => (
          <Collapsible key={log.id}>
            <Card>
              <CollapsibleTrigger className="w-full [&[data-state=open]_svg.chevron-caret]:rotate-180">
                <div className="flex items-center gap-3 p-4 text-sm hover:bg-muted/30 transition-colors">
                  <ChevronDown className="chevron-caret h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200" />
                  <span className="font-medium">{log.step_label || log.edge_function}</span>
                  <Badge variant="outline" className="text-xs">{log.edge_function}</Badge>
                  {log.model && <span className="text-xs text-muted-foreground">{log.model}</span>}
                  <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                    {log.input_tokens != null && <span>{log.input_tokens.toLocaleString()} in</span>}
                    {log.output_tokens != null && <span>{log.output_tokens.toLocaleString()} out</span>}
                    {(() => { const c = calcCost(log.model, log.input_tokens, log.output_tokens, modelRates); return c != null ? <span className="font-medium text-foreground">${c.toFixed(4)}</span> : null; })()}
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
                      <div className="max-h-[560px] overflow-y-auto">
                        {renderMessages(log.request_payload)}
                      </div>
                    </TabsContent>
                    <TabsContent value="response">
                      <div className="max-h-[560px] overflow-y-auto">
                        {renderResponseContent(log.response_payload)}
                      </div>
                    </TabsContent>
                    <TabsContent value="raw">
                      <div className="space-y-2">
                        <div className="flex justify-end"><CopyButton text={JSON.stringify({ request: log.request_payload, response: log.response_payload }, null, 2)} /></div>
                        <div className="max-h-[560px] overflow-y-auto">
                          <pre className="text-xs bg-muted/30 rounded p-3 whitespace-pre overflow-x-auto">{JSON.stringify({ request: log.request_payload, response: log.response_payload }, null, 2)}</pre>
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                </div>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        ))}
        {logs.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {session.extraction_method === 'spreadsheet'
              ? 'Spreadsheet imports are processed client-side without API calls.'
              : 'No API calls logged for this session.'}
          </p>
        )}
      </div>

      {/* User Feedback */}
      <FeedbackSection sessionId={session.id} />

      {/* Results Preview */}
      {(() => {
        const sr = session.step_results as Record<string, Json> | null;
        const dataObj = sr?.data as Record<string, Json> | undefined;
        const items = dataObj?.items as Array<Record<string, Json>> | undefined;
        if (!items || items.length === 0) return null;
        const totalItems = sr?.totalItems as number | undefined;
        const sessionConfidence = sr?.sessionConfidence as number | undefined;
        const count = totalItems ?? items.length;
        return (
          <Collapsible>
            <Card>
              <CollapsibleTrigger className="w-full [&[data-state=open]_svg.chevron-caret]:rotate-180">
                <div className="flex items-center gap-3 p-4 text-sm hover:bg-muted/30 transition-colors">
                  <ChevronDown className="chevron-caret h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200" />
                  <span className="font-semibold">Results Preview ({count} items)</span>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t border-border">
                  <ResultsPreviewTree items={items as any} totalItems={totalItems} sessionConfidence={sessionConfidence} />
                </div>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        );
      })()}
    </div>
  );
}
