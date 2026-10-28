import { ReportService } from '../services/ReportService';
import { ExpenseService } from '../services/ExpenseService';
import { DailyZReport } from '../../shared/types';

export interface RegisterClosureResult {
  zReport: DailyZReport;
  expectedCash: number;
  countedCash: number;
  variance: number; // positive = overage, negative = shortage
  status: 'BALANCED' | 'OVERAGE' | 'SHORTAGE';
}

export class RegisterClosureWorkflow {
  constructor(
    private reportService: ReportService = new ReportService(),
    private expenseService: ExpenseService = new ExpenseService()
  ) {}

  public executeClosure(countedCashCents: number, notes?: string): RegisterClosureResult {
    const zReport = this.reportService.getDailyZReport();
    const expectedCash = zReport.cashInDrawer;
    const variance = countedCashCents - expectedCash;

    let status: 'BALANCED' | 'OVERAGE' | 'SHORTAGE' = 'BALANCED';
    if (variance > 0) status = 'OVERAGE';
    if (variance < 0) status = 'SHORTAGE';

    return {
      zReport,
      expectedCash,
      countedCash: countedCashCents,
      variance,
      status
    };
  }
}

