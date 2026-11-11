import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { describeLoginOutcome, type LoginOutcome } from './loginErrors';

interface AuthState {
  session: Session | null;
  user: User | null;
  /** true, dopóki nie wiadomo, czy jest zapisana sesja (w tym obsługa linku z maila). */
  loading: boolean;
  /** Wysyła magic link. Konto nieistniejące wygląda jak sukces (zob. describeLoginOutcome). */
  signInWithEmail: (email: string) => Promise<LoginOutcome>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    // getSession czeka też na przetworzenie tokenów z linku w adresie (detectSessionInUrl).
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(next);
      setLoading(false);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const signInWithEmail = useCallback(async (email: string): Promise<LoginOutcome> => {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        // Konta zakłada operator / właściciel organizacji — link nie rejestruje nowych osób.
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/org`,
      },
    });
    return describeLoginOutcome(error);
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthState>(
    () => ({ session, user: session?.user ?? null, loading, signInWithEmail, signOut }),
    [session, loading, signInWithEmail, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth musi być użyty wewnątrz AuthProvider');
  return ctx;
}
