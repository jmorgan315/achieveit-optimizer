import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';
import { logActivity } from '@/utils/logActivity';

export type UserRole = 'user' | 'admin' | 'super_admin';

export function useAuth() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole>('user');
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [featureFlags, setFeatureFlags] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [domainError, setDomainError] = useState<string | null>(null);

  const isAdmin = role === 'admin' || role === 'super_admin';
  const isSuperAdmin = role === 'super_admin';

  const checkDomainAndProfile = useCallback(async (currentUser: User) => {
    const email = currentUser.email || '';
    if (!email.toLowerCase().endsWith('@achieveit.com')) {
      await supabase.auth.signOut();
      setUser(null);
      setRole('user');
      setDomainError('Access is restricted to AchieveIt employees. Please sign in with your @achieveit.com account.');
      setProfileLoaded(true);
      setLoading(false);
      return;
    }

    setDomainError(null);

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('is_admin, is_active, first_name, last_name, feature_flags, role, first_login_at')
      .eq('id', currentUser.id)
      .single();

    if (!profile) {
      await supabase.from('user_profiles').insert({
        id: currentUser.id,
        email: currentUser.email,
        first_name: currentUser.user_metadata?.full_name?.split(' ')[0] || currentUser.user_metadata?.name?.split(' ')[0] || null,
        last_name: currentUser.user_metadata?.full_name?.split(' ').slice(1).join(' ') || currentUser.user_metadata?.name?.split(' ').slice(1).join(' ') || null,
        is_admin: false,
        is_active: true,
        first_login_at: new Date().toISOString(),
      } as any);
      setRole('user');
      setProfileLoaded(true);
      setLoading(false);
    } else {
      if (!profile.is_active) {
        await supabase.auth.signOut();
        setUser(null);
        setRole('user');
        setDomainError('Your account has been deactivated. Please contact your administrator.');
        setProfileLoaded(true);
        setLoading(false);
        return;
      }

      // Track first login
      if (!(profile as any).first_login_at) {
        supabase
          .from('user_profiles')
          .update({ first_login_at: new Date().toISOString() } as any)
          .eq('id', currentUser.id)
          .then(({ error: updateErr }) => {
            if (updateErr) console.error('Failed to set first_login_at:', updateErr);
          });
      }

      const profileRole = (profile as any).role as string | undefined;
      if (profileRole === 'super_admin') setRole('super_admin');
      else if (profileRole === 'admin') setRole('admin');
      else if (profile.is_admin) setRole('admin'); // backward compat
      else setRole('user');

      const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ');
      setDisplayName(name || null);
      const flags = (profile as any).feature_flags;
      setFeatureFlags(typeof flags === 'object' && flags !== null ? flags : {});
      setProfileLoaded(true);
      setLoading(false);
    }
  }, []);

  const prevUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // Redirect to password setup for invite/recovery tokens
      if (_event === 'PASSWORD_RECOVERY') {
        navigate('/reset-password');
        // Don't return — fall through so profile check still runs for subsequent events
      }

      const currentUser = session?.user ?? null;
      setUser(currentUser);
      if (currentUser) {
        checkDomainAndProfile(currentUser);
        if (prevUserIdRef.current !== currentUser.id) {
          prevUserIdRef.current = currentUser.id;
          logActivity('login');
        }
      } else {
        setRole('user');
        setProfileLoaded(true);
        setLoading(false);
        prevUserIdRef.current = null;
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      if (currentUser) {
        checkDomainAndProfile(currentUser);
      } else {
        setProfileLoaded(true);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [checkDomainAndProfile, navigate]);

  const signIn = async (email: string, password: string) => {
    setDomainError(null);
    if (!email.toLowerCase().endsWith('@achieveit.com')) {
      return { error: { message: 'Please use your @achieveit.com email address.' } };
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: { message: error.message } };
    return { error: null };
  };

  const signUp = async (email: string, password: string, firstName?: string, lastName?: string) => {
    setDomainError(null);
    if (!email.toLowerCase().endsWith('@achieveit.com')) {
      return { error: { message: 'Please use your @achieveit.com email address.' } };
    }
    const fullName = [firstName, lastName].filter(Boolean).join(' ') || undefined;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: fullName ? { data: { full_name: fullName } } : undefined,
    });
    if (error) return { error: { message: error.message } };
    return { error: null };
  };

  const resetPassword = async (email: string) => {
    if (!email.toLowerCase().endsWith('@achieveit.com')) {
      return { error: { message: 'Please use your @achieveit.com email address.' } };
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) return { error: { message: error.message } };
    return { error: null };
  };

  const signOut = async () => {
    setDomainError(null);
    return await supabase.auth.signOut();
  };

  const isFullyLoaded = !loading && profileLoaded;

  return { user, role, isAdmin, isSuperAdmin, displayName, featureFlags, loading: !isFullyLoaded, domainError, signIn, signUp, resetPassword, signOut };
}
