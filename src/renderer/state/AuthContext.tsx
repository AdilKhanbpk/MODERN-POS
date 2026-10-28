import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from '../../shared/types';
import { Permission, Role, ROLE_PERMISSIONS } from '../../shared/constants/roles-permissions';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, passwordPlain: string) => Promise<void>;
  logout: () => void;
  hasPermission: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
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
    const loggedUser = await window.posApi.auth.login(username, passwordPlain);
    setUser(loggedUser);
  };

  const logout = () => {
    setUser(null);
  };

  const hasPermission = (permission: Permission): boolean => {
    if (!user) return false;
    const permissions = ROLE_PERMISSIONS[user.role as Role] || [];
    return permissions.includes(permission);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};

