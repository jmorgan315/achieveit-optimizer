import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Loader2, Star, ChevronDown, ChevronRight, Upload } from 'lucide-react';
import { format } from 'date-fns';

interface ReimportSummary {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
}

interface ReimportChange {
  type: string;
  name: string;
  order: string;
  fields?: Array<{ field: string; oldValue: string; newValue: string }>;
}

interface FeedbackRow {
  id: string;
  session_id: string;
  user_id: string;
  expected_item_count: number | null;
  actual_item_count: number;
  item_count_delta: number | null;
  hierarchy_rating: number | null;
  overall_rating: number | null;
  time_saved: string | null;
  open_feedback: string | null;
  created_at: string;
  org_name: string | null;
  document_name: string | null;
  user_email: string | null;
  reimport?: { summary: ReimportSummary; changes: ReimportChange[] } | null;
  hasFeedback: boolean;
}

interface GeneralFeedbackRow {
  id: string;
  user_id: string;
  category: string;
  subject: string | null;
  message: string;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
}

type SortKey = 'created_at' | 'overall_rating' | 'hierarchy_rating' | 'item_count_delta' | 'actual_item_count';
type SortDir = 'asc' | 'desc';

export default function FeedbackPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [generalRows, setGeneralRows] = useState<GeneralFeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: feedback } = await supabase
        .from('session_feedback')
        .select('*')
        .order('created_at', { ascending: false });

      let feedbackRows: FeedbackRow[] = [];
      const feedbackSessionIds = new Set<string>();

      if (feedback && feedback.length > 0) {
        const sessionIds = [...new Set(feedback.map(f => f.session_id))];
        const userIds = [...new Set(feedback.map(f => f.user_id))];
        sessionIds.forEach(id => feedbackSessionIds.add(id));

        const [{ data: sessions }, { data: profiles }] = await Promise.all([
          supabase.from('processing_sessions').select('id, org_name, document_name, step_results').in('id', sessionIds),
          supabase.from('user_profiles').select('id, email').in('id', userIds),
        ]);

        const sessionMap = new Map((sessions || []).map(s => [s.id, s]));
        const profileMap = new Map((profiles || []).map(p => [p.id, p]));

        feedbackRows = feedback.map(f => {
          const s = sessionMap.get(f.session_id);
          const p = profileMap.get(f.user_id);
          const stepResults = s?.step_results as Record<string, unknown> | null;
          const reimport = stepResults?.reimport as { summary: ReimportSummary; changes: ReimportChange[] } | undefined;
          return {
            ...f,
            org_name: s?.org_name ?? null,
            document_name: s?.document_name ?? null,
            user_email: p?.email ?? null,
            reimport: reimport ?? null,
            hasFeedback: true,
          };
        });
      }

      // Fetch sessions with reimports but no feedback row
      const { data: reimportSessions } = await supabase
        .from('processing_sessions')
        .select('id, user_id, org_name, document_name, step_results, created_at')
        .not('step_results->reimport', 'is', null);

      if (reimportSessions && reimportSessions.length > 0) {
        const reimportOnly = reimportSessions.filter(s => !feedbackSessionIds.has(s.id));
        if (reimportOnly.length > 0) {
          const roUserIds = [...new Set(reimportOnly.map(s => s.user_id).filter(Boolean))] as string[];
          const { data: roProfiles } = roUserIds.length > 0
            ? await supabase.from('user_profiles').select('id, email').in('id', roUserIds)
            : { data: [] as { id: string; email: string | null }[] };
          const roProfileMap = new Map((roProfiles || []).map(p => [p.id, p]));

          for (const s of reimportOnly) {
            const stepResults = s.step_results as Record<string, unknown> | null;
            const reimport = stepResults?.reimport as { summary: ReimportSummary; changes: ReimportChange[]; timestamp?: string } | undefined;
            if (!reimport) continue;
            const p = s.user_id ? roProfileMap.get(s.user_id) : null;
            feedbackRows.push({
              id: s.id,
              session_id: s.id,
              user_id: s.user_id ?? '',
              expected_item_count: null,
              actual_item_count: 0,
              item_count_delta: null,
              hierarchy_rating: null,
              overall_rating: null,
              time_saved: null,
              open_feedback: null,
              created_at: reimport.timestamp ?? s.created_at,
              org_name: s.org_name ?? null,
              document_name: s.document_name ?? null,
              user_email: p?.email ?? null,
              reimport,
              hasFeedback: false,
            });
          }
        }
      }

      setRows(feedbackRows);

      const { data: general } = await supabase
        .from('general_feedback')
        .select('*')
        .order('created_at', { ascending: false });

      if (general && general.length > 0) {
        const gUserIds = [...new Set(general.map(g => g.user_id))];
        const { data: gProfiles } = await supabase.from('user_profiles').select('id, email, first_name, last_name').in('id', gUserIds);
        const gMap = new Map((gProfiles || []).map(p => [p.id, p]));

        setGeneralRows(general.map(g => {
          const p = gMap.get(g.user_id);
          return {
            ...g,
            user_name: p ? [p.first_name, p.last_name].filter(Boolean).join(' ') || null : null,
            user_email: p?.email ?? null,
          };
        }));
      }

      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    let result = rows;
    if (dateFrom) result = result.filter(r => r.created_at >= dateFrom);
    if (dateTo) result = result.filter(r => r.created_at <= dateTo + 'T23:59:59');
    return result;
  }, [rows, dateFrom, dateTo]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filtered, sortKey, sortDir]);

  const stats = useMemo(() => {
    if (filtered.length === 0) return null;
    const withOverall = filtered.filter(r => r.overall_rating != null);
    const withHierarchy = filtered.filter(r => r.hierarchy_rating != null);
    const withDelta = filtered.filter(r => r.item_count_delta != null);
    const reimported = filtered.filter(r => !!r.reimport);
    const reimportPct = filtered.length > 0 ? ((reimported.length / filtered.length) * 100).toFixed(0) : '0';

    let avgReimport: { added: string; removed: string; modified: string } | null = null;
    if (reimported.length > 0) {
      const totals = reimported.reduce(
        (acc, r) => ({
          added: acc.added + (r.reimport?.summary.added ?? 0),
          removed: acc.removed + (r.reimport?.summary.removed ?? 0),
          modified: acc.modified + (r.reimport?.summary.modified ?? 0),
        }),
        { added: 0, removed: 0, modified: 0 }
      );
      avgReimport = {
        added: (totals.added / reimported.length).toFixed(1),
        removed: (totals.removed / reimported.length).toFixed(1),
        modified: (totals.modified / reimported.length).toFixed(1),
      };
    }

    return {
      count: filtered.length,
      avgOverall: withOverall.length ? (withOverall.reduce((s, r) => s + r.overall_rating!, 0) / withOverall.length).toFixed(1) : '—',
      avgHierarchy: withHierarchy.length ? (withHierarchy.reduce((s, r) => s + r.hierarchy_rating!, 0) / withHierarchy.length).toFixed(1) : '—',
      avgDelta: withDelta.length ? (withDelta.reduce((s, r) => s + r.item_count_delta!, 0) / withDelta.length).toFixed(1) : '—',
      reimportedCount: reimported.length,
      reimportPct,
      avgReimport,
    };
  }, [filtered]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const SortHeader = ({ label, k }: { label: string; k: SortKey }) => (
    <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort(k)}>
      {label} {sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </TableHead>
  );

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Feedback Overview</h1>

      <Tabs defaultValue="import">
        <TabsList>
          <TabsTrigger value="import">Import Signals ({rows.length})</TabsTrigger>
          <TabsTrigger value="general">General Feedback ({generalRows.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="import" className="space-y-4">
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <Card><CardContent className="p-4"><div className="text-2xl font-bold">{stats.count}</div><div className="text-sm text-muted-foreground">Total Sessions</div></CardContent></Card>
              <Card><CardContent className="p-4"><div className="text-2xl font-bold flex items-center gap-1"><Star className="h-4 w-4 text-warning" />{stats.avgOverall}</div><div className="text-sm text-muted-foreground">Avg Overall</div></CardContent></Card>
              <Card><CardContent className="p-4"><div className="text-2xl font-bold flex items-center gap-1"><Star className="h-4 w-4 text-primary" />{stats.avgHierarchy}</div><div className="text-sm text-muted-foreground">Avg Hierarchy</div></CardContent></Card>
              <Card><CardContent className="p-4"><div className="text-2xl font-bold">{stats.avgDelta}</div><div className="text-sm text-muted-foreground">Avg Item Delta</div></CardContent></Card>
              <Card><CardContent className="p-4"><div className="text-2xl font-bold flex items-center gap-1"><Upload className="h-4 w-4 text-primary" />{stats.reimportedCount} ({stats.reimportPct}%)</div><div className="text-sm text-muted-foreground">Re-imported</div></CardContent></Card>
              {stats.avgReimport && (
                <Card><CardContent className="p-4"><div className="text-lg font-bold">+{stats.avgReimport.added} / −{stats.avgReimport.removed} / ~{stats.avgReimport.modified}</div><div className="text-sm text-muted-foreground">Avg Re-import Changes</div></CardContent></Card>
              )}
            </div>
          )}

          <div className="flex gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-40" />
            </div>
          </div>

          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <SortHeader label="Date" k="created_at" />
                  <TableHead>User</TableHead>
                  <TableHead>Document</TableHead>
                  <TableHead>Org</TableHead>
                  <TableHead>Expected</TableHead>
                  <SortHeader label="Actual" k="actual_item_count" />
                  <SortHeader label="Delta" k="item_count_delta" />
                  <SortHeader label="Hierarchy" k="hierarchy_rating" />
                  <SortHeader label="Overall" k="overall_rating" />
                  <TableHead>Time Saved</TableHead>
                  <TableHead>Re-imported</TableHead>
                  <TableHead>Changes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map(r => (
                  <React.Fragment key={r.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                    >
                      <TableCell className="text-sm px-2">
                        {expandedId === r.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </TableCell>
                      <TableCell className="text-sm">{format(new Date(r.created_at), 'MMM d, yyyy')}</TableCell>
                      <TableCell className="text-sm">{r.user_email ?? '—'}</TableCell>
                      <TableCell className="text-sm max-w-[150px] truncate">{r.document_name ?? '—'}</TableCell>
                      <TableCell className="text-sm">{r.org_name ?? '—'}</TableCell>
                      <TableCell className="text-sm">{r.expected_item_count ?? '—'}</TableCell>
                      <TableCell className="text-sm">{r.actual_item_count}</TableCell>
                      <TableCell className="text-sm">
                        {r.item_count_delta != null ? (
                          <Badge variant={r.item_count_delta === 0 ? 'default' : 'secondary'}>
                            {r.item_count_delta > 0 ? '+' : ''}{r.item_count_delta}
                          </Badge>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-sm">{r.hierarchy_rating ?? '—'}/5</TableCell>
                      <TableCell className="text-sm">{r.overall_rating ?? '—'}/5</TableCell>
                      <TableCell className="text-sm">{r.time_saved ?? '—'}</TableCell>
                      <TableCell className="text-sm">
                        {r.reimport ? (
                          <Badge variant="outline" className="text-primary border-primary/30">Yes</Badge>
                        ) : (
                          <span className="text-muted-foreground">No</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {r.reimport ? (
                          <span className="font-mono text-xs">
                            +{r.reimport.summary.added} / −{r.reimport.summary.removed} / ~{r.reimport.summary.modified}
                          </span>
                        ) : '—'}
                      </TableCell>
                    </TableRow>
                    {expandedId === r.id && (
                      <TableRow>
                        <TableCell colSpan={13} className="bg-muted/30 px-6 py-3">
                          <div className="space-y-3">
                            <p className="text-sm">
                              <span className="font-medium">Feedback:</span>{' '}
                              {r.open_feedback || <span className="text-muted-foreground italic">No comments provided</span>}
                            </p>

                            {r.reimport && r.reimport.changes.length > 0 && (
                              <div className="space-y-2">
                                <p className="text-sm font-medium flex items-center gap-1">
                                  <Upload className="h-3.5 w-3.5 text-primary" /> Re-import Details
                                </p>
                                <div className="grid gap-1 ml-5">
                                  {r.reimport.changes.filter(c => c.type === 'added').length > 0 && (
                                    <div>
                                      <p className="text-xs font-medium text-green-600">Added ({r.reimport.changes.filter(c => c.type === 'added').length})</p>
                                      {r.reimport.changes.filter(c => c.type === 'added').map((c, i) => (
                                        <p key={i} className="text-xs text-muted-foreground ml-2">{c.order} — {c.name}</p>
                                      ))}
                                    </div>
                                  )}
                                  {r.reimport.changes.filter(c => c.type === 'removed').length > 0 && (
                                    <div>
                                      <p className="text-xs font-medium text-red-600">Removed ({r.reimport.changes.filter(c => c.type === 'removed').length})</p>
                                      {r.reimport.changes.filter(c => c.type === 'removed').map((c, i) => (
                                        <p key={i} className="text-xs text-muted-foreground ml-2 line-through">{c.order} — {c.name}</p>
                                      ))}
                                    </div>
                                  )}
                                  {r.reimport.changes.filter(c => c.type === 'modified').length > 0 && (
                                    <div>
                                      <p className="text-xs font-medium text-amber-600">Modified ({r.reimport.changes.filter(c => c.type === 'modified').length})</p>
                                      {r.reimport.changes.filter(c => c.type === 'modified').map((c, i) => (
                                        <div key={i} className="ml-2">
                                          <p className="text-xs font-medium">{c.order} — {c.name}</p>
                                          {c.fields?.map((f, j) => (
                                            <p key={j} className="text-[11px] text-muted-foreground ml-3">
                                              {f.field}: <span className="text-red-500">{f.oldValue}</span> → <span className="text-green-600">{f.newValue}</span>
                                            </p>
                                          ))}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            <button
                              className="text-sm text-primary hover:underline"
                              onClick={(e) => { e.stopPropagation(); navigate(`/admin/sessions/${r.session_id}`); }}
                            >
                              View session details →
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
                {sorted.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center text-muted-foreground py-8">No import feedback found</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="general" className="space-y-4">
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {generalRows.map(g => (
                  <TableRow key={g.id}>
                    <TableCell className="text-sm whitespace-nowrap">{format(new Date(g.created_at), 'MMM d, yyyy')}</TableCell>
                    <TableCell className="text-sm">{g.user_name || g.user_email || '—'}</TableCell>
                    <TableCell><Badge variant="outline">{g.category}</Badge></TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate">{g.subject || '—'}</TableCell>
                    <TableCell className="text-sm max-w-[300px]">{g.message}</TableCell>
                  </TableRow>
                ))}
                {generalRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No general feedback yet</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
