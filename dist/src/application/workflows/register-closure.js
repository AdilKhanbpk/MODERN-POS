"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RegisterClosureWorkflow = void 0;
const ReportService_1 = require("../services/ReportService");
const ExpenseService_1 = require("../services/ExpenseService");
class RegisterClosureWorkflow {
    reportService;
    expenseService;
    constructor(reportService = new ReportService_1.ReportService(), expenseService = new ExpenseService_1.ExpenseService()) {
        this.reportService = reportService;
        this.expenseService = expenseService;
    }
    executeClosure(countedCashCents, notes) {
        const zReport = this.reportService.getDailyZReport();
        const expectedCash = zReport.cashInDrawer;
        const variance = countedCashCents - expectedCash;
        let status = 'BALANCED';
        if (variance > 0)
            status = 'OVERAGE';
        if (variance < 0)
            status = 'SHORTAGE';
        return {
            zReport,
            expectedCash,
            countedCash: countedCashCents,
            variance,
            status
        };
    }
}
exports.RegisterClosureWorkflow = RegisterClosureWorkflow;
