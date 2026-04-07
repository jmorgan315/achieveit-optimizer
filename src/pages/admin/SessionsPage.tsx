import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';

interface Session {
  id: string;
  created_at: string;
  org_name: string | null;
  document_name: string | null;
  extraction_method: string | null;
  total_items_extracted: number | null;
  total_api_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_duration_ms: number;
  status: string;
  user_id: string | null;
}

interface UserProfile {
  id: string;
  email: string | null;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [userMap, setUserMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [methodFilter, setMethodFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('processing_sessions')
        .select('*')
        .order('created_at', { ascending: false });
      setSessions(data || []);

      // Fetch user profiles for email display
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, email');
      if (profiles) {
        const map: Record<string, string> = {};
        profiles.forEach((p: UserProfile) => { if (p.email) map[p.id] = p.email; });
        setUserMap(map);
      }

      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    return sessions.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (methodFilter !== 'all' && s.extraction_method !== methodFilter) return false;
      if (dateFrom && s.created_at < dateFrom) return false;
      if (dateTo && s.created_at > dateTo + 'T23:59:59') return false;
      return true;
    });
  }, [sessions, statusFilter, methodFilter, dateFrom, dateTo]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, s) => ({
        tokens: acc.tokens + s.total_input_tokens + s.total_output_tokens,
        calls: acc.calls + s.total_api_calls,
        sessions: acc.sessions + 1,
      }),
      { tokens: 0, calls: 0, sessions: 0 }
    );
  }, [filtered]);

  const statusVariant = (s: string) => {
    if (s === 'completed') return 'default';
    if (s === 'failed') return 'destructive';
    return 'secondary';
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold text-foreground">Processing Sessions</h1>

      <div className="grid grid-cols-3 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Sessions</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{totals.sessions}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total Tokens</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{totals.tokens.toLocaleString()}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">API Calls</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{totals.calls.toLocaleString()}</p></CardContent></Card>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-muted-foreground">From</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">To</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Status</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Method</label>
          <Select value={methodFilter} onValueChange={setMethodFilter}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="text">Text</SelectItem>
              <SelectItem value="vision">Vision</SelectItem>
              <SelectItem value="fallback_parser">Fallback</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Org Name</TableHead>
              <TableHead>Document</TableHead>
              <TableHead>Method</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead className="text-right">API Calls</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No sessions found</TableCell></TableRow>
            ) : (
              filtered.map((s) => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => navigate(`/admin/sessions/${s.id}`)}>
                  <TableCell className="text-xs">{format(new Date(s.created_at), 'MMM d, HH:mm')}</TableCell>
                  <TableCell>{s.org_name || '—'}</TableCell>
                  <TableCell className="max-w-[200px] truncate">{s.document_name || '—'}</TableCell>
                  <TableCell><Badge variant="outline">{s.extraction_method || '—'}</Badge></TableCell>
                  <TableCell className="text-right">{s.total_items_extracted ?? '—'}</TableCell>
                  <TableCell className="text-right">{s.total_api_calls}</TableCell>
                  <TableCell className="text-right">{(s.total_input_tokens + s.total_output_tokens).toLocaleString()}</TableCell>
                  <TableCell className="text-right">{s.total_duration_ms ? `${(s.total_duration_ms / 1000).toFixed(1)}s` : '—'}</TableCell>
                  <TableCell><Badge variant={statusVariant(s.status)}>{s.status}</Badge></TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
