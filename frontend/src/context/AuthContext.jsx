import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

const API_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null); // In-memory only — for Socket.IO
  const [loading, setLoading] = useState(true);

  // On mount, verify session via HttpOnly cookie
  useEffect(() => {
    fetch(`${API_URL}/api/auth/me`, {
      credentials: 'include', // send cookie
    })
      .then((res) => {
        if (!res.ok) throw new Error('Not authenticated');
        return res.json();
      })
      .then((data) => {
        setUser(data.user);
        setToken(data.token); // in-memory only for Socket.IO
      })
      .catch(() => {
        setUser(null);
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const register = useCallback(async ({ name, email, password, role }) => {
    const res = await fetch(`${API_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // receive & store cookie
      body: JSON.stringify({ name, email, password, role }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');

    setToken(data.token); // in-memory for Socket.IO
    setUser(data.user);
    return data;
  }, []);

  const login = useCallback(async ({ email, password }) => {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // receive & store cookie
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');

    setToken(data.token); // in-memory for Socket.IO
    setUser(data.user);
    return data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include', // clear cookie server-side
      });
    } catch {
      // ignore network errors during logout
    }
    setToken(null);
    setUser(null);
  }, []);

  /** Helper: fetch with both cookie + Authorization header (belt-and-suspenders) */
  const authFetch = useCallback(
    (url, opts = {}) => {
      const headers = { ...opts.headers };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      return fetch(url, { ...opts, credentials: 'include', headers });
    },
    [token],
  );

  const value = {
    user,
    token,
    loading,
    isAuthenticated: !!user,
    isTeacher: user?.role === 'TEACHER',
    isStudent: user?.role === 'STUDENT',
    register,
    login,
    logout,
    authFetch,
    API_URL,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export default AuthContext;
