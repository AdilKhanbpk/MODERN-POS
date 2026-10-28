import React, { useState } from 'react';
import { useAuth } from '../state/AuthContext';
import { Lock, UserCheck, AlertCircle } from 'lucide-react';

export const LoginModal: React.FC = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(username, password);
    } catch (err: any) {
      setError(err.message || 'Login failed. Please verify credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-slate-800 border border-slate-700 w-full max-w-md rounded-2xl p-8 shadow-2xl">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-blue-600/20 text-blue-500 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-blue-500/30">
            <Lock className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-white tracking-wide">Modern Retail POS</h2>
          <p className="text-slate-400 text-sm mt-1">100% Offline Secured Local Terminal</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              Username
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
              placeholder="e.g. admin or cashier"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold py-3 rounded-xl transition duration-150 flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 disabled:opacity-50 mt-6"
          >
            <UserCheck className="w-5 h-5" />
            <span>{isSubmitting ? 'Authenticating...' : 'Sign In to Register'}</span>
          </button>
        </form>

        <div className="mt-6 text-center text-xs text-slate-500">
          Default Admin: <span className="text-slate-300 font-mono">admin</span> | Password: <span className="text-slate-300 font-mono">admin123</span>
        </div>
      </div>
    </div>
  );
};

