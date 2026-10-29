import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from '../../shared/types';
import { Permission, Role, ROLE_PERMISSIONS } from '../../shared/constants/roles-permissions';
import { LoginResult } from '../../shared/types/auth-security';

interface AuthContextType {
  user: User | null;
  sessionToken: string | null;
  permissions: Set<string>;
  loading: boolean;
  login: (username: string, passwordPlain: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (permission: Permission | string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    async function checkAuth() {
      try {
        if (window.posApi?.auth) {
          const current = await window.posApi.auth.getCurrentUser();
          setUser(current);
        }
      } catch (err) {
        console.error('Failed to get current user:', err);
      } finally {
        setLoading(false);
      }
    }
    checkAuth();
  }, []);

  const login = async (username: string, passwordPlain: string) => {
    if (!window.posApi?.auth) throw new Error('POS API not available');
    const res = await window.posApi.auth.login(username, passwordPlain);

    if ('sessionToken' in res) {
      const loginRes = res as LoginResult;
      setSessionToken(loginRes.sessionToken);
      setPermissions(new Set(loginRes.permissions));
      setUser({
        id: loginRes.user.id as any,
        username: loginRes.user.username,
        fullName: loginRes.user.fullName,
        role: loginRes.user.roleName as any,
        isActive: true,
        createdAt: new Date().toISOString()
      });
    } else {
      const u = res as User;
      setUser(u);
    }
  };

  const logout = async () => {
    if (window.posApi?.auth) {
      await window.posApi.auth.logout(sessionToken || undefined);
    }
    setUser(null);
    setSessionToken(null);
    setPermissions(new Set());
  };

  const hasPermission = (permission: Permission | string): boolean => {
    if (!user) return false;

    // Owner and ADMIN have master bypass
    if (user.role === Role.ADMIN || (user.role as any) === 'Owner') {
      return true;
    }

    // Granular permissions check
    const code = String(permission);
    if (permissions.has(code)) return true;
    if (permissions.has(code.replace(/\./g, ':'))) return true;
    if (permissions.has(code.replace(/:/g, '.'))) return true;

    // Fallback to legacy role mapping
    const legacyPerms = ROLE_PERMISSIONS[user.role as Role] || [];
    return legacyPerms.includes(permission as Permission);
  };

  return (
    <AuthContext.Provider value={{ user, sessionToken, permissions, loading, login, logout, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
