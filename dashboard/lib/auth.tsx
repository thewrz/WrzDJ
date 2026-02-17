'use client';

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from './api';
import { initSeenPages } from './help/seen-pages';

export type UserRole = 'admin' | 'dj' | 'pending';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  role: UserRole | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [role, setRole] = useState<UserRole | null>(null);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    api.setToken(null);
    api.setUnauthorizedHandler(null);
    setIsAuthenticated(false);
    setRole(null);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      api.setToken(token);
      api.setUnauthorizedHandler(() => {
        logout();
        window.location.href = '/login';
      });
      api.getMe()
        .then((user) => {
          initSeenPages(user.help_pages_seen ?? []);
          setIsAuthenticated(true);
          setRole(user.role as UserRole);
        })
        .catch(() => {
          localStorage.removeItem('token');
          api.setToken(null);
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, [logout]);

  const login = async (username: string, password: string) => {
    const { access_token } = await api.login(username, password);
    localStorage.setItem('token', access_token);
    api.setToken(access_token);
    api.setUnauthorizedHandler(() => {
      logout();
      window.location.href = '/login';
    });
    const user = await api.getMe();
    initSeenPages(user.help_pages_seen ?? []);
    setRole(user.role as UserRole);
    setIsAuthenticated(true);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, role, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
