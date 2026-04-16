import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2, Save, KeyRound } from 'lucide-react';

export default function AccountSettingsPage() {
  const { user, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [featureFlags, setFeatureFlags] = useState<Record<string, unknown>>({});
  const [savingFlag, setSavingFlag] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('user_profiles')
      .select('first_name, last_name, feature_flags')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setFirstName(data.first_name ?? '');
          setLastName(data.last_name ?? '');
          const flags = (data.feature_flags ?? {}) as Record<string, unknown>;
          setFeatureFlags(flags);
          setEmailNotifications(flags.email_notifications !== false);
        }
        setLoading(false);
      });
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from('user_profiles')
      .update({ first_name: firstName.trim() || null, last_name: lastName.trim() || null })
      .eq('id', user.id);
    if (error) {
      toast.error('Failed to save profile');
    } else {
      toast.success('Profile updated');
    }
    setSaving(false);
  };

  const handleToggleEmailNotifications = async (checked: boolean) => {
    if (!user) return;
    const previous = emailNotifications;
    setEmailNotifications(checked);
    setSavingFlag(true);
    const nextFlags = { ...featureFlags, email_notifications: checked };
    const { error } = await supabase
      .from('user_profiles')
      .update({ feature_flags: nextFlags })
      .eq('id', user.id);
    if (error) {
      setEmailNotifications(previous);
      toast.error('Failed to update preference');
    } else {
      setFeatureFlags(nextFlags);
      toast.success(checked ? 'Email notifications enabled' : 'Email notifications disabled');
    }
    setSavingFlag(false);
  };

  const handleResetPassword = async () => {
    if (!user?.email) return;
    setSendingReset(true);
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Password reset email sent. Check your inbox.');
    }
    setSendingReset(false);
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background">
      <Header
        onHomeClick={() => navigate('/')}
        user={user}
        isAdmin={isAdmin}
        onSignOut={() => signOut()}
      />
      <div className="container mx-auto max-w-lg px-4 py-10 space-y-6">
        <h1 className="text-2xl font-semibold">Account Settings</h1>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Profile</CardTitle>
            <CardDescription>Update your personal information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" value={user.email ?? ''} disabled />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">First Name</Label>
                    <Input
                      id="firstName"
                      value={firstName}
                      onChange={e => setFirstName(e.target.value)}
                      placeholder="First name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">Last Name</Label>
                    <Input
                      id="lastName"
                      value={lastName}
                      onChange={e => setLastName(e.target.value)}
                      placeholder="Last name"
                    />
                  </div>
                </div>
                <Button onClick={handleSave} disabled={saving} className="w-full">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Save Changes
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Notifications</CardTitle>
            <CardDescription>Control how we contact you</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="emailNotifications" className="text-sm font-medium">
                  Email me when imports complete
                </Label>
                <p className="text-xs text-muted-foreground">
                  Receive an email when a plan import finishes processing or fails.
                </p>
              </div>
              <Switch
                id="emailNotifications"
                checked={emailNotifications}
                onCheckedChange={handleToggleEmailNotifications}
                disabled={loading || savingFlag}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Security</CardTitle>
            <CardDescription>Manage your password</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={handleResetPassword} disabled={sendingReset} className="w-full">
              {sendingReset ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <KeyRound className="h-4 w-4 mr-2" />}
              Change Password
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              We'll send a password reset link to {user.email}.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
