import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
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

    // Check / create profile
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('is_admin, is_active')
      .eq('id', currentUser.id)
      .single();

    if (!profile) {
      // Auto-create profile on first sign-in
      await supabase.from('user_profiles').insert({
        id: currentUser.id,
        email: currentUser.email,
        full_name: currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || null,
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

  const signInWithMicrosoft = async () => {
    setDomainError(null);
    return await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        scopes: 'email profile openid',
        redirectTo: window.location.origin,
      },
    });
  };

  const signOut = async () => {
    setDomainError(null);
    return await supabase.auth.signOut();
  };

  return { user, isAdmin, loading, domainError, signInWithMicrosoft, signOut };
}
