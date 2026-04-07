import { useAuth } from '@/hooks/useAuth';
import { Loader2 } from 'lucide-react';
import { Navigate, Outlet } from 'react-router-dom';

export function AdminGuard() {
  const { user, isAdmin, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-foreground">Access Denied</h1>
          <p className="text-muted-foreground">You don't have permission to view this page.</p>
          <a href="/" className="text-sm text-primary hover:text-primary/80 transition-colors">
            ← Back to app
          </a>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
