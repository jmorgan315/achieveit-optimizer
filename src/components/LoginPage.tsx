/**
 * AZURE AD SETUP INSTRUCTIONS (Manual — Required Before Microsoft Sign-In Works)
 *
 * 1. Register an app in Azure AD Portal:
 *    - Go to https://portal.azure.com → Azure Active Directory → App registrations → New registration
 *    - Name: "AchieveIt Plan Import Assistant"
 *    - Supported account types: Choose based on whether external users need access
 *      - "Accounts in this organizational directory only" for single-tenant
 *      - "Accounts in any organizational directory" for multi-tenant
 *    - Redirect URI (Web platform): https://yntqxpvmswpdviwwlsyy.supabase.co/auth/v1/callback
 *    - Click "Register"
 *
 * 2. Note from the app's Overview page:
 *    - Application (client) ID
 *    - Directory (tenant) ID
 *
 * 3. Create a client secret:
 *    - Go to Certificates & secrets → New client secret
 *    - Copy the secret value immediately (it won't be shown again)
 *
 * 4. API Permissions:
 *    - Ensure "Microsoft Graph → User.Read" (delegated) is granted
 *    - Click "Grant admin consent" if required by your organization
 *
 * 5. Configure Supabase:
 *    - Supabase Dashboard → Authentication → Providers → Azure
 *    - Enable the Azure provider
 *    - Enter the Client ID, Client Secret, and Azure Tenant URL
 *      (Tenant URL format: https://login.microsoftonline.com/<TENANT_ID>)
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2 } from 'lucide-react';

interface LoginPageProps {
  onSignInWithMicrosoft: () => Promise<{ error: { message: string } | null }>;
  domainError?: string | null;
}

function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export function LoginPage({ onSignInWithMicrosoft, domainError }: LoginPageProps) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleMicrosoftSignIn = async () => {
    setError(null);
    setLoading(true);
    const { error } = await onSignInWithMicrosoft();
    if (error) {
      setError(
        'Microsoft sign-in is not configured yet. Please contact your administrator.'
      );
      setLoading(false);
    }
  };

  const displayError = domainError || error;

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>Welcome</CardTitle>
          <CardDescription>
            Sign in with your AchieveIt Microsoft account to continue
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {displayError && (
            <Alert variant="destructive">
              <AlertDescription>{displayError}</AlertDescription>
            </Alert>
          )}

          <Button
            onClick={handleMicrosoftSignIn}
            disabled={loading}
            variant="outline"
            className="w-full h-11 text-sm font-medium gap-3"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MicrosoftIcon className="h-5 w-5" />
            )}
            Sign in with Microsoft
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
