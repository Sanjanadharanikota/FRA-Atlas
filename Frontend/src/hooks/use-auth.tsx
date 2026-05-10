import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type AuthUser = {
  id: string;
  email: string;
  full_name?: string;
  role: string;
};

type AuthSession = {
  token: string;
  user: AuthUser;
};

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (fullName: string, email: string, password: string) => Promise<void>;
  logout: () => void;
};

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://127.0.0.1:8000";
export const AUTH_STORAGE_KEY = "fra_auth_session_v2";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const persistSession = (session: AuthSession | null) => {
  if (session) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  else localStorage.removeItem(AUTH_STORAGE_KEY);
};

export const getStoredToken = () => {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    return parsed?.token || null;
  } catch {
    return null;
  }
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const applySession = useCallback((session: AuthSession | null) => {
    setUser(session?.user || null);
    setToken(session?.token || null);
    persistSession(session);
  }, []);

  useEffect(() => {
    const loadSession = async () => {
      try {
        const storedToken = getStoredToken();
        if (!storedToken) {
          applySession(null);
          return;
        }
        const res = await fetch(`${BACKEND_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${storedToken}` },
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload?.data) {
          applySession(null);
          return;
        }
        applySession({ token: storedToken, user: payload.data });
      } finally {
        setLoading(false);
      }
    };
    void loadSession();
  }, [applySession]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${BACKEND_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.message || "Login failed");
    applySession(payload.data);
  }, [applySession]);

  const signup = useCallback(async (fullName: string, email: string, password: string) => {
    const res = await fetch(`${BACKEND_URL}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full_name: fullName, email, password }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.message || "Signup failed");
    applySession(payload.data);
  }, [applySession]);

  const logout = useCallback(() => {
    applySession(null);
  }, [applySession]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    token,
    isAuthenticated: Boolean(user && token),
    loading,
    login,
    signup,
    logout,
  }), [user, token, loading, login, signup, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
