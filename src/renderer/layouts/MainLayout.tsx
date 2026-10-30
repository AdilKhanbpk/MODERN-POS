import React from 'react';
import { useAuth } from '../state/AuthContext';
import {
  LayoutDashboard,
  ShoppingCart,
  Boxes,
  Truck,
  Users,
  Building2,
  BookOpenCheck,
  Receipt,
  UserSquare2,
  BarChart3,
  Settings,
  LogOut,
  WifiOff,
  ShieldCheck
} from 'lucide-react';

interface MainLayoutProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  children: React.ReactNode;
}

export const MainLayout: React.FC<MainLayoutProps> = ({ activeTab, setActiveTab, children }) => {
  const { user, logout } = useAuth();

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'sales', label: 'POS Terminal (F1)', icon: ShoppingCart },
    { id: 'inventory', label: 'Inventory (F2)', icon: Boxes },
    { id: 'purchases', label: 'Purchases', icon: Truck },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'suppliers', label: 'Suppliers', icon: Building2 },
    { id: 'accounts', label: 'Accounts Ledger', icon: BookOpenCheck },
    { id: 'expenses', label: 'Expenses', icon: Receipt },
    { id: 'employees', label: 'Employees', icon: UserSquare2 },
    { id: 'reports', label: 'Reports & Z-Close', icon: BarChart3 },
    { id: 'settings', label: 'Settings & Backup', icon: Settings }
  ];

  return (
    <div className="flex h-dvh w-full min-h-0 overflow-hidden bg-slate-950 text-slate-700 font-sans">
      {/* Sidebar Navigation */}
      <aside className="w-64 min-h-0 bg-white border-r border-slate-300 flex flex-col shrink-0">
        {/* Brand Header */}
        <div className="p-5 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-700 flex items-center justify-center font-bold text-xl text-slate-900">
              P
            </div>
            <div>
              <h1 className="font-bold text-sm tracking-wide text-slate-800">MODERN POS</h1>
              <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                <WifiOff className="w-3.5 h-3.5 text-blue-600" />
                <span>100% Offline</span>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation links */}
        <nav aria-label="Main navigation" className="flex-1 overflow-y-auto p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition duration-150 ${
                  isActive
                    ? 'bg-blue-700 text-white'
                    : 'text-slate-600 hover:text-slate-800 hover:bg-slate-100'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Cashier / User Footer */}
        <div className="p-3 border-t border-slate-200 bg-white">
          <div className="flex items-center justify-between p-2 rounded-lg bg-slate-100 border border-slate-200">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-xs font-bold text-blue-700">
                <ShieldCheck className="w-4 h-4 text-blue-700" />
              </div>
              <div className="truncate text-left">
                <div className="text-xs font-semibold text-slate-800 truncate">{user?.fullName || 'Cashier'}</div>
                <div className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">{user?.role}</div>
              </div>
            </div>

            <button
              onClick={logout}
              title="Sign Out"
              className="p-1.5 rounded-lg text-slate-500 hover:text-red-700 hover:bg-slate-200 transition"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 min-h-0 bg-slate-100 overflow-hidden">
        {children}
      </main>
    </div>
  );
};
