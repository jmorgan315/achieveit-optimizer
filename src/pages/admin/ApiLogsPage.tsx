import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';

interface LogRow {
  id: string;
  created_at: string;
  session_id: string;
  edge_function: string;
  step_label: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  duration_ms: number | null;
  status: string | null;
}

export default function ApiLogsPage() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fnFilter, setFnFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modelFilter, setModelFilter] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('api_call_logs')
        .select('id,created_at,session_id,edge_function,step_label,model,input_tokens,output_tokens,duration_ms,status')
        .order('created_at', { ascending: false })
        .limit(500);
      setLogs((data || []) as LogRow[]);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (fnFilter !== 'all' && l.edge_function !== fnFilter) return false;
      if (statusFilter !== 'all' && l.status !== statusFilter) return false;
      if (modelFilter && !l.model?.toLowerCase().includes(modelFilter.toLowerCase())) return false;
      return true;
    });
  }, [logs, fnFilter, statusFilter, modelFilter]);

  const edgeFunctions = useMemo(() => [...new Set(logs.map((l) => l.edge_function))], [logs]);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold text-foreground">API Call Logs</h1>

      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-muted-foreground">Edge Function</label>
          <Select value={fnFilter} onValueChange={setFnFilter}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {edgeFunctions.map((fn) => <SelectItem key={fn} value={fn}>{fn}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Status</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="timeout">Timeout</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Model</label>
          <Input value={modelFilter} onChange={(e) => setModelFilter(e.target.value)} placeholder="Filter model…" className="w-48" />
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Session</TableHead>
              <TableHead>Edge Function</TableHead>
              <TableHead>Step</TableHead>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">In</TableHead>
              <TableHead className="text-right">Out</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No logs found</TableCell></TableRow>
            ) : (
              filtered.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-xs">{format(new Date(l.created_at), 'MMM d, HH:mm:ss')}</TableCell>
                  <TableCell>
                    <Link to={`/admin/sessions/${l.session_id}`} className="text-primary hover:underline text-xs font-mono">
                      {l.session_id.slice(0, 8)}…
                    </Link>
                  </TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{l.edge_function}</Badge></TableCell>
                  <TableCell className="text-xs">{l.step_label || '—'}</TableCell>
                  <TableCell className="text-xs">{l.model || '—'}</TableCell>
                  <TableCell className="text-right text-xs">{l.input_tokens?.toLocaleString() ?? '—'}</TableCell>
                  <TableCell className="text-right text-xs">{l.output_tokens?.toLocaleString() ?? '—'}</TableCell>
                  <TableCell className="text-right text-xs">{l.duration_ms ? `${(l.duration_ms / 1000).toFixed(1)}s` : '—'}</TableCell>
                  <TableCell><Badge variant={l.status === 'success' ? 'default' : 'destructive'} className="text-xs">{l.status}</Badge></TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
