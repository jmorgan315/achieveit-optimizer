import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [linkExpired, setLinkExpired] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const navigate = useNavigate();

  // Detect invite vs reset from URL hash
  const hash = typeof window !== 'undefined' ? window.location.hash : '';
  const isInvite = hash.includes('type=invite') || hash.includes('type=magiclink');

  useEffect(() => {
    // 1. Check URL hash for explicit error params from Supabase
    if (hash.includes('error=') || hash.includes('error_code=') || hash.includes('otp_expired')) {
      setLinkExpired(true);
      setCheckingSession(false);
      return;
    }

    // 2. Listen for PASSWORD_RECOVERY / SIGNED_IN events
    let resolved = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        resolved = true;
        setCheckingSession(false);
      }
    });

    // 3. Fallback: check session after a short delay
    const timer = setTimeout(async () => {
      if (resolved) return;
      const { data: { session } } = await supabase.auth.getSession();
      const hasRecoveryToken = hash.includes('access_token') || hash.includes('refresh_token');
      if (!session && !hasRecoveryToken) {
        setLinkExpired(true);
      }
      setCheckingSession(false);
    }, 1500);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, [hash]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setLoading(false);
      const msg = error.message || '';
      if (/session|missing|expired/i.test(msg)) {
        setLinkExpired(true);
      } else {
        setError(msg);
      }
    } else {
      // Mark first_login_at for invited users completing onboarding
      try {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (currentUser) {
          await supabase
            .from('user_profiles')
            .update({ first_login_at: new Date().toISOString() } as any)
            .eq('id', currentUser.id)
            .is('first_login_at', null);
        }
      } catch (e) {
        console.error('Failed to set first_login_at:', e);
      }
      setLoading(false);
      setSuccess(true);
      setTimeout(() => navigate('/'), 2000);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>
            {linkExpired
              ? 'This link has expired'
              : isInvite
              ? 'Welcome! Set Your Password'
              : 'Set New Password'}
          </CardTitle>
          <CardDescription>
            {linkExpired
              ? 'Your invite or password reset link is no longer valid. Links expire after a short time and can only be used once.'
              : isInvite
              ? 'Create a password for your new account'
              : 'Enter your new password below'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {linkExpired ? (
            <div className="space-y-3">
              <Button onClick={() => navigate('/')} className="w-full">
                Request a new link
              </Button>
              <Button onClick={() => navigate('/')} variant="outline" className="w-full">
                Back to sign in
              </Button>
            </div>
          ) : checkingSession ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : success ? (
            <Alert>
              <AlertDescription>Password updated! Redirecting…</AlertDescription>
            </Alert>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="password">New Password</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm Password</Label>
                <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={6} />
              </div>
              <Button type="submit" disabled={loading} className="w-full">
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Update Password
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
