import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, FileText, Building2, Clock, Loader2, FolderOpen } from 'lucide-react';

interface SessionRow {
  id: string;
  org_name: string | null;
  document_name: string | null;
  status: string;
  current_step: string;
  total_items_extracted: number | null;
  created_at: string;
}

interface RecentSessionsPageProps {
  onNewImport: () => void;
  onSelectSession: (session: SessionRow) => void;
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-200 hover:bg-emerald-500/15">Completed</Badge>;
    case 'in_progress':
      return (
        <Badge className="bg-amber-500/15 text-amber-700 border-amber-200 hover:bg-amber-500/15">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          Processing
        </Badge>
      );
    case 'failed':
      return <Badge className="bg-red-500/15 text-red-700 border-red-200 hover:bg-red-500/15">Failed</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export function RecentSessionsPage({ onNewImport, onSelectSession }: RecentSessionsPageProps) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSessions() {
      const { data, error } = await supabase
        .from('processing_sessions')
        .select('id, org_name, document_name, status, current_step, total_items_extracted, created_at')
        .not('document_name', 'is', null)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        console.error('Failed to fetch sessions:', error);
      } else {
        setSessions((data as SessionRow[]) || []);
      }
      setLoading(false);
    }
    fetchSessions();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Plan Import Assistant</h1>
            <p className="text-muted-foreground mt-1">Import and structure strategic plans for AchieveIt</p>
          </div>
          <Button onClick={onNewImport} size="default">
            <Plus className="h-4 w-4 mr-2" />
            New Import
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : sessions.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <FolderOpen className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h2 className="text-lg font-semibold text-foreground mb-2">No imports yet</h2>
              <p className="text-muted-foreground mb-6">Click "New Import" to get started with your first plan.</p>
              <Button onClick={onNewImport}>
                <Plus className="h-4 w-4 mr-2" />
                New Import
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => (
              <Card
                key={session.id}
                className="cursor-pointer transition-colors hover:bg-accent/50"
                onClick={() => onSelectSession(session)}
              >
                <CardContent className="flex items-center gap-4 py-4 px-5">
                  <FileText className="h-5 w-5 text-muted-foreground shrink-0" />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-medium text-foreground truncate">
                        {session.document_name || 'Untitled'}
                      </span>
                      <StatusBadge status={session.status} />
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      {session.org_name && (
                        <span className="flex items-center gap-1 truncate">
                          <Building2 className="h-3.5 w-3.5 shrink-0" />
                          {session.org_name}
                        </span>
                      )}
                      <span className="flex items-center gap-1 shrink-0">
                        <Clock className="h-3.5 w-3.5" />
                        {formatRelativeTime(session.created_at)}
                      </span>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    {session.status === 'completed' && session.total_items_extracted != null ? (
                      <span className="text-sm font-medium text-foreground">
                        {session.total_items_extracted} items
                      </span>
                    ) : session.status === 'in_progress' ? (
                      <span className="text-sm text-muted-foreground">Processing…</span>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
