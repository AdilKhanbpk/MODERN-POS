import React, { useState, useEffect } from 'react';
import { Employee, PayrollRun } from '../../../shared/types';
import { UserSquare2, Plus, RefreshCw, X, DollarSign, History } from 'lucide-react';

export const EmployeesPage: React.FC = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payrollHistory, setPayrollHistory] = useState<PayrollRun[]>([]);
  const [activeTab, setActiveTab] = useState<'employees' | 'payroll'>('employees');
  const [loading, setLoading] = useState(true);

  // Add employee modal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [designation, setDesignation] = useState('Cashier');
  const [salaryDecimal, setSalaryDecimal] = useState('35000');

  // Payroll modal
  const [isPayrollModalOpen, setIsPayrollModalOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [allowanceDecimal, setAllowanceDecimal] = useState('0');
  const [deductionDecimal, setDeductionDecimal] = useState('0');

  const loadData = async () => {
    try {
      setLoading(true);
      if (window.posApi) {
        const [empList, payList] = await Promise.all([
          window.posApi.employees.list(),
          window.posApi.employees.listPayrollHistory()
        ]);
        setEmployees(empList);
        setPayrollHistory(payList);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await window.posApi.employees.save({
        fullName,
        phone,
        designation,
        baseSalary: Math.round(parseFloat(salaryDecimal) * 100)
      });
      setIsAddModalOpen(false);
      setFullName('');
      setPhone('');
      loadData();
    } catch (err: any) {
      alert(`Error adding employee: ${err.message}`);
    }
  };

  const openPayrollModal = (emp: Employee) => {
    setSelectedEmployee(emp);
    setAllowanceDecimal('0');
    setDeductionDecimal('0');
    setIsPayrollModalOpen(true);
  };

  const handleRunPayroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee) return;
    try {
      await window.posApi.employees.runPayroll({
        employeeId: selectedEmployee.id,
        month,
        allowance: Math.round(parseFloat(allowanceDecimal || '0') * 100),
        deduction: Math.round(parseFloat(deductionDecimal || '0') * 100)
      });
      setIsPayrollModalOpen(false);
      loadData();
    } catch (err: any) {
      alert(`Payroll error: ${err.message}`);
    }
  };

  const formatCents = (cents: number) => `Rs. ${(cents / 100).toFixed(2)}`;

  return (
    <div className="flex-1 p-6 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-xl font-bold text-white">Employees & Staff Payroll</h1>
          <p className="text-xs text-slate-400">Staff management, base salaries, and salary disbursements</p>
        </div>

        <div className="flex gap-2">
          <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1 text-xs font-semibold">
            <button
              onClick={() => setActiveTab('employees')}
              className={`px-3 py-1.5 rounded-lg transition ${activeTab === 'employees' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              Employees
            </button>
            <button
              onClick={() => setActiveTab('payroll')}
              className={`px-3 py-1.5 rounded-lg transition ${activeTab === 'payroll' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              Payroll History
            </button>
          </div>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl transition"
          >
            <Plus className="w-4 h-4" /> Add Employee
          </button>
          <button
            onClick={loadData}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {activeTab === 'employees' ? (
        <div className="flex-1 overflow-y-auto mt-4 rounded-xl border border-slate-800 bg-slate-900/60">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900 text-slate-400 font-semibold border-b border-slate-800 sticky top-0">
              <tr>
                <th className="p-3">Staff Member</th>
                <th className="p-3">Designation</th>
                <th className="p-3">Phone</th>
                <th className="p-3 text-right">Base Salary</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {employees.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500">
                    No staff members registered. Click "Add Employee" to register staff.
                  </td>
                </tr>
              ) : (
                employees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-slate-800/40 transition">
                    <td className="p-3 font-semibold text-white">{emp.fullName}</td>
                    <td className="p-3 text-slate-300">{emp.designation}</td>
                    <td className="p-3 font-mono text-slate-400">{emp.phone}</td>
                    <td className="p-3 text-right font-mono font-bold text-emerald-400">{formatCents(emp.baseSalary)}</td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => openPayrollModal(emp)}
                        className="px-2.5 py-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 rounded-lg text-xs font-semibold flex items-center gap-1 transition ml-auto"
                      >
                        <DollarSign className="w-3.5 h-3.5" /> Pay Salary
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto mt-4 rounded-xl border border-slate-800 bg-slate-900/60">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900 text-slate-400 font-semibold border-b border-slate-800 sticky top-0">
              <tr>
                <th className="p-3">Month</th>
                <th className="p-3">Employee</th>
                <th className="p-3 text-right">Base</th>
                <th className="p-3 text-right">Allowance</th>
                <th className="p-3 text-right">Deduction</th>
                <th className="p-3 text-right">Net Paid</th>
                <th className="p-3">Date Disbursed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {payrollHistory.map((p) => (
                <tr key={p.id} className="hover:bg-slate-800/40 transition">
                  <td className="p-3 font-mono font-bold text-white">{p.month}</td>
                  <td className="p-3 font-semibold text-slate-300">{p.employeeName}</td>
                  <td className="p-3 text-right font-mono text-slate-400">{formatCents(p.baseSalary)}</td>
                  <td className="p-3 text-right font-mono text-emerald-400">{p.allowance > 0 ? `+${formatCents(p.allowance)}` : '-'}</td>
                  <td className="p-3 text-right font-mono text-rose-400">{p.deduction > 0 ? `-${formatCents(p.deduction)}` : '-'}</td>
                  <td className="p-3 text-right font-mono font-bold text-emerald-400">{formatCents(p.netPayable)}</td>
                  <td className="p-3 text-slate-500 font-mono text-[11px]">{new Date(p.paymentDate || p.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Employee Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-2xl p-6 shadow-2xl">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800 mb-4">
              <h3 className="text-base font-bold text-white">Register Staff Member</h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddEmployee} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  placeholder="e.g. Bilal Tariq"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Phone Number</label>
                <input
                  type="text"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                  placeholder="03121234567"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Designation</label>
                <input
                  type="text"
                  required
                  value={designation}
                  onChange={(e) => setDesignation(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  placeholder="Cashier, Manager, Stock Clerk"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Monthly Base Salary (Rs.)</label>
                <input
                  type="number"
                  step="1"
                  required
                  value={salaryDecimal}
                  onChange={(e) => setSalaryDecimal(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 rounded-xl transition mt-4"
              >
                Save Staff
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Process Payroll Modal */}
      {isPayrollModalOpen && selectedEmployee && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-2xl p-6 shadow-2xl">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800 mb-4">
              <div>
                <h3 className="text-base font-bold text-white">Disburse Salary</h3>
                <p className="text-xs text-slate-400">{selectedEmployee.fullName} (Base: {formatCents(selectedEmployee.baseSalary)})</p>
              </div>
              <button onClick={() => setIsPayrollModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleRunPayroll} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Salary Month</label>
                <input
                  type="month"
                  required
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Bonus / Allowance (+ Rs.)</label>
                <input
                  type="number"
                  value={allowanceDecimal}
                  onChange={(e) => setAllowanceDecimal(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono text-emerald-400"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Deduction / Advance (- Rs.)</label>
                <input
                  type="number"
                  value={deductionDecimal}
                  onChange={(e) => setDeductionDecimal(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono text-rose-400"
                />
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex justify-between items-center">
                <span className="text-slate-400">Net Payable:</span>
                <span className="font-mono text-base font-bold text-white">
                  {formatCents(
                    selectedEmployee.baseSalary +
                    Math.round(parseFloat(allowanceDecimal || '0') * 100) -
                    Math.round(parseFloat(deductionDecimal || '0') * 100)
                  )}
                </span>
              </div>
              <button
                type="submit"
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl transition mt-4"
              >
                Confirm Salary Payout
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

