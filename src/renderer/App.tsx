import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './state/AuthContext';
import { LoginModal } from './components/LoginModal';
import { MainLayout } from './layouts/MainLayout';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { SalesPage } from './pages/sales/SalesPage';
import { InventoryPage } from './pages/inventory/InventoryPage';
import { PurchasesPage } from './pages/purchases/PurchasesPage';
import { CustomersPage } from './pages/customers/CustomersPage';
import { SuppliersPage } from './pages/suppliers/SuppliersPage';
import { AccountsPage } from './pages/accounts/AccountsPage';
import { ExpensesPage } from './pages/expenses/ExpensesPage';
import { EmployeesPage } from './pages/employees/EmployeesPage';
import { ReportsPage } from './pages/reports/ReportsPage';
import { SettingsPage } from './pages/settings/SettingsPage';

const AppContent: React.FC = () => {
  const { user, loading } = useAuth();
  const [activeTab, setActiveTab] = useState<string>('sales'); // Default directly into POS register

  // Global POS keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        setActiveTab('sales');
      } else if (e.key === 'F2') {
        e.preventDefault();
        setActiveTab('inventory');
      } else if (e.key === 'F3') {
        e.preventDefault();
        setActiveTab('customers');
      } else if (e.key === 'F4') {
        e.preventDefault();
        setActiveTab('reports');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-950 text-white font-mono text-sm">
        <div className="animate-pulse">Loading Secure Offline POS Terminal...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginModal />;
  }

  return (
    <MainLayout activeTab={activeTab} setActiveTab={setActiveTab}>
      {activeTab === 'dashboard' && <DashboardPage onNavigate={setActiveTab} />}
      {activeTab === 'sales' && <SalesPage />}
      {activeTab === 'inventory' && <InventoryPage />}
      {activeTab === 'purchases' && <PurchasesPage />}
      {activeTab === 'customers' && <CustomersPage />}
      {activeTab === 'suppliers' && <SuppliersPage />}
      {activeTab === 'accounts' && <AccountsPage />}
      {activeTab === 'expenses' && <ExpensesPage />}
      {activeTab === 'employees' && <EmployeesPage />}
      {activeTab === 'reports' && <ReportsPage />}
      {activeTab === 'settings' && <SettingsPage />}
    </MainLayout>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
};

