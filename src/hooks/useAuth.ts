import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [featureFlags, setFeatureFlags] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [domainError, setDomainError] = useState<string | null>(null);

  const checkDomainAndProfile = useCallback(async (currentUser: User) => {
    const email = currentUser.email || '';
    if (!email.endsWith('@achieveit.com')) {
      await supabase.auth.signOut();
      setUser(null);
      setIsAdmin(false);
      setDomainError('Access is restricted to AchieveIt employees. Please sign in with your @achieveit.com account.');
      return;
    }

    setDomainError(null);

    // Check profile (auto-created by DB trigger on signup)
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('is_admin, is_active, first_name, last_name, feature_flags')
      .eq('id', currentUser.id)
      .single();

    if (!profile) {
      // Fallback: create profile if trigger didn't fire
      await supabase.from('user_profiles').insert({
        id: currentUser.id,
        email: currentUser.email,
        first_name: currentUser.user_metadata?.full_name?.split(' ')[0] || currentUser.user_metadata?.name?.split(' ')[0] || null,
        last_name: currentUser.user_metadata?.full_name?.split(' ').slice(1).join(' ') || currentUser.user_metadata?.name?.split(' ').slice(1).join(' ') || null,
        is_admin: false,
        is_active: true,
      });
      setIsAdmin(false);
    } else {
      if (!profile.is_active) {
        await supabase.auth.signOut();
        setUser(null);
        setIsAdmin(false);
        setDomainError('Your account has been deactivated. Please contact your administrator.');
        return;
      }
      setIsAdmin(profile.is_admin ?? false);
      const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ');
      setDisplayName(name || null);
      const flags = (profile as any).feature_flags;
      setFeatureFlags(typeof flags === 'object' && flags !== null ? flags : {});
    }
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      setLoading(false);
      if (currentUser) {
        checkDomainAndProfile(currentUser);
      } else {
        setIsAdmin(false);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      setLoading(false);
      if (currentUser) {
        checkDomainAndProfile(currentUser);
      }
    });

    return () => subscription.unsubscribe();
  }, [checkDomainAndProfile]);

  const signIn = async (email: string, password: string) => {
    setDomainError(null);
    if (!email.endsWith('@achieveit.com')) {
      return { error: { message: 'Please use your @achieveit.com email address.' } };
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: { message: error.message } };
    return { error: null };
  };

  const signUp = async (email: string, password: string, firstName?: string, lastName?: string) => {
    setDomainError(null);
    if (!email.endsWith('@achieveit.com')) {
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
    if (!email.endsWith('@achieveit.com')) {
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

  return { user, isAdmin, displayName, featureFlags, loading, domainError, signIn, signUp, resetPassword, signOut };
}
