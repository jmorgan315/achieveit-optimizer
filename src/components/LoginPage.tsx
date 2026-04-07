import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';

interface LoginPageProps {
  onSignIn: (email: string, password: string) => Promise<{ error: { message: string } | null }>;
  onSignUp: (email: string, password: string, firstName?: string, lastName?: string) => Promise<{ error: { message: string } | null }>;
  onResetPassword: (email: string) => Promise<{ error: { message: string } | null }>;
  domainError?: string | null;
}

export function LoginPage({ onSignIn, onSignUp, onResetPassword, domainError }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');

  const validateDomain = (email: string) => {
    if (!email.endsWith('@achieveit.com')) {
      setError('Please use your @achieveit.com email address.');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!validateDomain(email)) return;

    setLoading(true);
    try {
      if (mode === 'forgot') {
        const result = await onResetPassword(email);
        if (result.error) {
          setError(result.error.message);
        } else {
          setSuccess('Password reset link sent. Check your email.');
        }
      } else if (mode === 'signup') {
        const result = await onSignUp(email, password, firstName, lastName);
        if (result.error) {
          setError(result.error.message);
        } else {
          setSuccess('Account created! You can now sign in.');
          setMode('signin');
        }
      } else {
        const result = await onSignIn(email, password);
        if (result.error) {
          setError(result.error.message);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const displayError = domainError || error;

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>
            {mode === 'forgot' ? 'Reset Password' : mode === 'signup' ? 'Create Account' : 'Welcome'}
          </CardTitle>
          <CardDescription>
            {mode === 'forgot'
              ? 'Enter your email to receive a reset link'
              : 'Sign in with your AchieveIt email to continue'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {displayError && (
              <Alert variant="destructive">
                <AlertDescription>{displayError}</AlertDescription>
              </Alert>
            )}
            {success && (
              <Alert>
                <AlertDescription>{success}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@achieveit.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            {mode !== 'forgot' && (
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
            )}

            <Button type="submit" disabled={loading} className="w-full">
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {mode === 'forgot' ? 'Send Reset Link' : mode === 'signup' ? 'Create Account' : 'Sign In'}
            </Button>

            <div className="text-center text-sm space-y-1">
              {mode === 'signin' && (
                <>
                  <button type="button" onClick={() => { setMode('forgot'); setError(null); setSuccess(null); }} className="text-primary hover:underline block mx-auto">
                    Forgot password?
                  </button>
                  <p className="text-muted-foreground">
                    No account?{' '}
                    <button type="button" onClick={() => { setMode('signup'); setError(null); setSuccess(null); }} className="text-primary hover:underline">
                      Sign up
                    </button>
                  </p>
                </>
              )}
              {mode === 'signup' && (
                <p className="text-muted-foreground">
                  Already have an account?{' '}
                  <button type="button" onClick={() => { setMode('signin'); setError(null); setSuccess(null); }} className="text-primary hover:underline">
                    Sign in
                  </button>
                </p>
              )}
              {mode === 'forgot' && (
                <button type="button" onClick={() => { setMode('signin'); setError(null); setSuccess(null); }} className="text-primary hover:underline">
                  Back to sign in
                </button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
