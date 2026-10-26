'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, isSsoSession, setToken } from './api';
import { User } from './types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  /** Signs in with an app token handed back by the Auth0 callback. */
  loginWithToken(token: string): Promise<void>;
  logout(): void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // Starts true on both server and client; the token is only readable after hydration.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api<User>('/api/auth/me')
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ token: string; user: User }>('/api/auth/login', { method: 'POST', json: { email, password } });
    setToken(res.token);
    setUser(res.user);
  }, []);

  const loginWithToken = useCallback(async (token: string) => {
    setToken(token, true);
    try {
      setUser(await api<User>('/api/auth/me'));
    } catch (err) {
      setToken(null);
      throw err;
    }
  }, []);

  const logout = useCallback(() => {
    const sso = isSsoSession();
    setToken(null);
    setUser(null);
    if (sso) window.location.assign('/api/auth/auth0/logout');
  }, []);

  return <AuthContext.Provider value={{ user, loading, login, loginWithToken, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
