import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

interface ActivityRow {
  id: string;
  user_id: string;
  activity_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
  user_email?: string;
  user_name?: string;
}

const TYPE_OPTIONS = ['all', 'login', 'session_start', 'session_complete', 'export', 'feedback_submitted'];

export default function ActivityPage() {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, { email: string | null; first_name: string | null; last_name: string | null }>>({});
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('');

  useEffect(() => {
    (async () => {
      const [actRes, profRes] = await Promise.all([
        (supabase as any).from('user_activity_log').select('*').order('created_at', { ascending: false }).limit(500),
        supabase.from('user_profiles').select('id, email, first_name, last_name'),
      ]);
      const activities = (actRes.data ?? []) as ActivityRow[];
      const profs: Record<string, { email: string | null; first_name: string | null; last_name: string | null }> = {};
      for (const p of (profRes.data ?? [])) {
        profs[p.id] = { email: p.email, first_name: p.first_name, last_name: p.last_name };
      }
      setProfiles(profs);
      setRows(activities);
      setLoading(false);
    })();
  }, []);

  const enriched = useMemo(() => rows.map(r => ({
    ...r,
    user_email: profiles[r.user_id]?.email ?? r.user_id,
    user_name: [profiles[r.user_id]?.first_name, profiles[r.user_id]?.last_name].filter(Boolean).join(' ') || null,
  })), [rows, profiles]);

  const filtered = useMemo(() => {
    let list = enriched;
    if (typeFilter !== 'all') list = list.filter(r => r.activity_type === typeFilter);
    if (userFilter) {
      const q = userFilter.toLowerCase();
      list = list.filter(r => (r.user_email ?? '').toLowerCase().includes(q) || (r.user_name ?? '').toLowerCase().includes(q));
    }
    return list;
  }, [enriched, typeFilter, userFilter]);

  // Stats
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const loginsToday = enriched.filter(r => r.activity_type === 'login' && r.created_at.startsWith(today)).length;
  const activeUsersWeek = new Set(enriched.filter(r => r.created_at >= weekAgo).map(r => r.user_id)).size;
  const totalExports = enriched.filter(r => r.activity_type === 'export').length;

  const typeBadgeColor = (t: string) => {
    switch (t) {
      case 'login': return 'default';
      case 'session_start': return 'secondary';
      case 'session_complete': return 'default';
      case 'export': return 'outline';
      case 'feedback_submitted': return 'secondary';
      default: return 'outline';
    }
  };

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Activity Log</h1>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="p-4 text-center"><div className="text-2xl font-bold">{loginsToday}</div><div className="text-sm text-muted-foreground">Logins today</div></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><div className="text-2xl font-bold">{activeUsersWeek}</div><div className="text-sm text-muted-foreground">Active users (7d)</div></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><div className="text-2xl font-bold">{totalExports}</div><div className="text-sm text-muted-foreground">Total exports</div></CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TYPE_OPTIONS.map(t => (
              <SelectItem key={t} value={t}>{t === 'all' ? 'All types' : t.replace(/_/g, ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input placeholder="Filter by user..." value={userFilter} onChange={e => setUserFilter(e.target.value)} className="max-w-xs" />
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date / Time</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Activity</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{r.user_name || r.user_email}</div>
                    {r.user_name && <div className="text-xs text-muted-foreground">{r.user_email}</div>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={typeBadgeColor(r.activity_type) as any}>{r.activity_type.replace(/_/g, ' ')}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                    {Object.keys(r.metadata || {}).length > 0 ? JSON.stringify(r.metadata) : '—'}
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">No activity found</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
