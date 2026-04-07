import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Plus, FileText, Building2, Clock, Loader2, FolderOpen, Trash2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

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
  userId: string;
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

export function RecentSessionsPage({ onNewImport, onSelectSession, userId }: RecentSessionsPageProps) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const fetchSessions = async () => {
    let query = supabase
      .from('processing_sessions')
      .select('id, org_name, document_name, status, current_step, total_items_extracted, created_at')
      .not('document_name', 'is', null)
      .order('created_at', { ascending: false })
      .limit(20)
      .eq('user_id', userId);

    const { data, error } = await query;

    if (error) {
      console.error('Failed to fetch sessions:', error);
    } else {
      setSessions((data as SessionRow[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchSessions();
  }, [userId]);

  // Poll for updates while any session is in_progress
  useEffect(() => {
    const hasInProgress = sessions.some((s) => s.status === 'in_progress');
    if (!hasInProgress) return;

    const interval = setInterval(() => {
      fetchSessions();
    }, 10000);

    return () => clearInterval(interval);
  }, [sessions, userId]);

  async function handleDelete(sessionId: string) {
    setDeletingId(sessionId);
    try {
      const { error: logsErr } = await supabase
        .from('api_call_logs')
        .delete()
        .eq('session_id', sessionId);
      if (logsErr) throw logsErr;

      const { error: sessErr } = await supabase
        .from('processing_sessions')
        .delete()
        .eq('id', sessionId);
      if (sessErr) throw sessErr;

      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      toast.success('Session deleted');
    } catch (err: any) {
      console.error('Delete failed:', err);
      toast.error('Failed to delete session');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleCancel(sessionId: string) {
    setCancellingId(sessionId);
    try {
      const { error } = await supabase
        .from('processing_sessions')
        .update({ status: 'failed', current_step: 'cancelled', pipeline_run_id: null })
        .eq('id', sessionId);
      if (error) throw error;

      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, status: 'failed', current_step: 'cancelled' } : s,
        ),
      );
      toast.success('Import cancelled');
    } catch (err: any) {
      console.error('Cancel failed:', err);
      toast.error('Failed to cancel session');
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Hero CTA Section */}
      <div className="max-w-xl mx-auto text-center px-4 py-5 sm:py-8">
        <h1 className="text-xl sm:text-2xl font-bold text-foreground">Plan Import Assistant</h1>
        <p className="text-muted-foreground mt-1 mb-5">Import and structure strategic plans for AchieveIt</p>
        <Button onClick={onNewImport} size="lg" className="w-full sm:w-[300px]">
          <Plus className="h-4 w-4 mr-2" />
          New Import
        </Button>
        <p className="text-sm text-muted-foreground mt-3">Upload a PDF, Word, or Excel file to get started</p>
      </div>

      {/* Loading spinner */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Recent Imports Section */}
      {!loading && sessions.length > 0 && (
        <div className="max-w-3xl mx-auto px-4 sm:px-0 pb-8">
          <div className="border-t border-border pt-6 mb-4">
            <h2 className="text-lg font-semibold text-muted-foreground">Recent Imports</h2>
          </div>
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

                  <div className="flex items-center gap-2 shrink-0">
                    {session.status === 'completed' && session.total_items_extracted != null && (
                      <span className="text-sm font-medium text-foreground mr-1">
                        {session.total_items_extracted} items
                      </span>
                    )}
                    {session.status === 'in_progress' && (
                      <>
                        <span className="text-sm text-muted-foreground mr-1">Processing…</span>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-amber-600"
                              onClick={(e) => e.stopPropagation()}
                              disabled={cancellingId === session.id}
                            >
                              {cancellingId === session.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <XCircle className="h-4 w-4" />
                              )}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Cancel this import?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will stop processing and mark the session as failed.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Keep Running</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleCancel(session.id)}>
                                Cancel Import
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </>
                    )}

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={(e) => e.stopPropagation()}
                          disabled={deletingId === session.id}
                        >
                          {deletingId === session.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete this session?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete the session and all its logs. This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Keep</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => handleDelete(session.id)}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
