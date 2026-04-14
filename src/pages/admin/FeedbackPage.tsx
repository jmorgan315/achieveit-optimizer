import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Loader2, Star, ChevronDown, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';

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
}

type SortKey = 'created_at' | 'overall_rating' | 'hierarchy_rating' | 'item_count_delta' | 'actual_item_count';
type SortDir = 'asc' | 'desc';

export default function FeedbackPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<FeedbackRow[]>([]);
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

      if (!feedback || feedback.length === 0) { setRows([]); setLoading(false); return; }

      const sessionIds = [...new Set(feedback.map(f => f.session_id))];
      const userIds = [...new Set(feedback.map(f => f.user_id))];

      const [{ data: sessions }, { data: profiles }] = await Promise.all([
        supabase.from('processing_sessions').select('id, org_name, document_name').in('id', sessionIds),
        supabase.from('user_profiles').select('id, email').in('id', userIds),
      ]);

      const sessionMap = new Map((sessions || []).map(s => [s.id, s]));
      const profileMap = new Map((profiles || []).map(p => [p.id, p]));

      const merged: FeedbackRow[] = feedback.map(f => {
        const s = sessionMap.get(f.session_id);
        const p = profileMap.get(f.user_id);
        return {
          ...f,
          org_name: s?.org_name ?? null,
          document_name: s?.document_name ?? null,
          user_email: p?.email ?? null,
        };
      });

      setRows(merged);
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
    return {
      count: filtered.length,
      avgOverall: withOverall.length ? (withOverall.reduce((s, r) => s + r.overall_rating!, 0) / withOverall.length).toFixed(1) : '—',
      avgHierarchy: withHierarchy.length ? (withHierarchy.reduce((s, r) => s + r.hierarchy_rating!, 0) / withHierarchy.length).toFixed(1) : '—',
      avgDelta: withDelta.length ? (withDelta.reduce((s, r) => s + r.item_count_delta!, 0) / withDelta.length).toFixed(1) : '—',
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

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card><CardContent className="p-4"><div className="text-2xl font-bold">{stats.count}</div><div className="text-sm text-muted-foreground">Total Feedback</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-2xl font-bold flex items-center gap-1"><Star className="h-4 w-4 text-warning" />{stats.avgOverall}</div><div className="text-sm text-muted-foreground">Avg Overall</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-2xl font-bold flex items-center gap-1"><Star className="h-4 w-4 text-primary" />{stats.avgHierarchy}</div><div className="text-sm text-muted-foreground">Avg Hierarchy</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-2xl font-bold">{stats.avgDelta}</div><div className="text-sm text-muted-foreground">Avg Item Delta</div></CardContent></Card>
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

      <div className="border rounded-lg">
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map(r => (
              <>
                <TableRow
                  key={r.id}
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
                </TableRow>
                {expandedId === r.id && (
                  <TableRow key={`${r.id}-detail`}>
                    <TableCell colSpan={11} className="bg-muted/30 px-6 py-3">
                      <div className="space-y-2">
                        <p className="text-sm">
                          <span className="font-medium">Feedback:</span>{' '}
                          {r.open_feedback || <span className="text-muted-foreground italic">No comments provided</span>}
                        </p>
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
              </>
            ))}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-muted-foreground py-8">No feedback found</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    (async () => {
      const { data: feedback } = await supabase
        .from('session_feedback')
        .select('*')
        .order('created_at', { ascending: false });

      if (!feedback || feedback.length === 0) { setRows([]); setLoading(false); return; }

      const sessionIds = [...new Set(feedback.map(f => f.session_id))];
      const userIds = [...new Set(feedback.map(f => f.user_id))];

      const [{ data: sessions }, { data: profiles }] = await Promise.all([
        supabase.from('processing_sessions').select('id, org_name, document_name').in('id', sessionIds),
        supabase.from('user_profiles').select('id, email').in('id', userIds),
      ]);

      const sessionMap = new Map((sessions || []).map(s => [s.id, s]));
      const profileMap = new Map((profiles || []).map(p => [p.id, p]));

      const merged: FeedbackRow[] = feedback.map(f => {
        const s = sessionMap.get(f.session_id);
        const p = profileMap.get(f.user_id);
        return {
          ...f,
          org_name: s?.org_name ?? null,
          document_name: s?.document_name ?? null,
          user_email: p?.email ?? null,
        };
      });

      setRows(merged);
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
    return {
      count: filtered.length,
      avgOverall: withOverall.length ? (withOverall.reduce((s, r) => s + r.overall_rating!, 0) / withOverall.length).toFixed(1) : '—',
      avgHierarchy: withHierarchy.length ? (withHierarchy.reduce((s, r) => s + r.hierarchy_rating!, 0) / withHierarchy.length).toFixed(1) : '—',
      avgDelta: withDelta.length ? (withDelta.reduce((s, r) => s + r.item_count_delta!, 0) / withDelta.length).toFixed(1) : '—',
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

      {/* Summary Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card><CardContent className="p-4"><div className="text-2xl font-bold">{stats.count}</div><div className="text-sm text-muted-foreground">Total Feedback</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-2xl font-bold flex items-center gap-1"><Star className="h-4 w-4 text-warning" />{stats.avgOverall}</div><div className="text-sm text-muted-foreground">Avg Overall</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-2xl font-bold flex items-center gap-1"><Star className="h-4 w-4 text-primary" />{stats.avgHierarchy}</div><div className="text-sm text-muted-foreground">Avg Hierarchy</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-2xl font-bold">{stats.avgDelta}</div><div className="text-sm text-muted-foreground">Avg Item Delta</div></CardContent></Card>
        </div>
      )}

      {/* Date Filters */}
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

      {/* Table */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map(r => (
              <TableRow key={r.id}>
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
              </TableRow>
            ))}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground py-8">No feedback found</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
