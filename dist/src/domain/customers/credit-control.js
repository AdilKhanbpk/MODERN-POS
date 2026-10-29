"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreditControlEvaluator = exports.WalkInCreditForbiddenError = exports.CustomerInactiveError = exports.CustomerOverdueError = exports.CreditLimitExceededError = exports.CustomerCreditError = void 0;
class CustomerCreditError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CustomerCreditError';
    }
}
exports.CustomerCreditError = CustomerCreditError;
class CreditLimitExceededError extends CustomerCreditError {
    constructor(message) {
        super(message);
        this.name = 'CreditLimitExceededError';
    }
}
exports.CreditLimitExceededError = CreditLimitExceededError;
class CustomerOverdueError extends CustomerCreditError {
    constructor(message) {
        super(message);
        this.name = 'CustomerOverdueError';
    }
}
exports.CustomerOverdueError = CustomerOverdueError;
class CustomerInactiveError extends CustomerCreditError {
    constructor(message) {
        super(message);
        this.name = 'CustomerInactiveError';
    }
}
exports.CustomerInactiveError = CustomerInactiveError;
class WalkInCreditForbiddenError extends CustomerCreditError {
    constructor(message) {
        super(message);
        this.name = 'WalkInCreditForbiddenError';
    }
}
exports.WalkInCreditForbiddenError = WalkInCreditForbiddenError;
class CreditControlEvaluator {
    /**
     * Authoritative Domain Rule:
     * Evaluates whether a customer can be granted additional credit based on:
     * 1. Active status
     * 2. Walk-in restriction
     * 3. Credit limit exposure (existing balance + new credit)
     * 4. Overdue documents (exceeding customer credit_days)
     * 5. Active business policy: BLOCK | REQUIRE_APPROVAL | WARN | IGNORE
     */
    static evaluate(context) {
        const { customer, newCreditMinor, policy, outstandingInvoices, hasManagerApproval } = context;
        // 1. Inactive customers cannot buy on credit
        if (!customer.isActive) {
            throw new CustomerInactiveError(`Customer "${customer.name}" (${customer.customerCode}) is inactive/archived. Credit sales are strictly prohibited.`);
        }
        // 2. Dedicated Walk-in customers cannot buy on credit
        if (customer.customerCode === 'WALK-IN' || customer.name === 'Walk-in Customer') {
            throw new WalkInCreditForbiddenError('Credit sales cannot be charged to the Walk-in customer account. Please select or register a named customer.');
        }
        const currentBalanceMinor = customer.calculatedBalanceMinor ?? customer.balanceMinor ?? 0;
        const totalExposureMinor = currentBalanceMinor + newCreditMinor;
        const creditLimitMinor = customer.creditLimitMinor || 0;
        // Exceeds limit if creditLimit > 0 and total exposure > creditLimit
        const exceedsLimit = creditLimitMinor > 0 && totalExposureMinor > creditLimitMinor;
        // Check overdue documents
        const overdueInvoices = outstandingInvoices.filter(inv => inv.isOverdue);
        const isOverdue = overdueInvoices.length > 0;
        const requiresAction = exceedsLimit || isOverdue;
        let errorMessage;
        if (exceedsLimit) {
            const excess = totalExposureMinor - creditLimitMinor;
            errorMessage = `Credit limit exceeded! Customer limit: Rs. ${(creditLimitMinor / 100).toFixed(2)}, ` +
                `Current balance: Rs. ${(currentBalanceMinor / 100).toFixed(2)}, ` +
                `New credit: Rs. ${(newCreditMinor / 100).toFixed(2)}, ` +
                `Excess: Rs. ${(excess / 100).toFixed(2)}.`;
        }
        else if (isOverdue) {
            errorMessage = `Customer has ${overdueInvoices.length} overdue invoice(s). Total overdue: Rs. ${(overdueInvoices.reduce((s, i) => s + i.outstandingMinor, 0) / 100).toFixed(2)}.`;
        }
        // If within limit and no overdue invoices, credit is unconditionally allowed
        if (!requiresAction) {
            return {
                allowed: true,
                policy,
                creditLimitMinor,
                currentBalanceMinor,
                newCreditMinor,
                totalExposureMinor,
                exceedsLimit: false,
                isOverdue: false,
                overdueInvoices: [],
                requiresApproval: false
            };
        }
        // Apply configured policy
        switch (policy) {
            case 'IGNORE':
                return {
                    allowed: true,
                    policy,
                    creditLimitMinor,
                    currentBalanceMinor,
                    newCreditMinor,
                    totalExposureMinor,
                    exceedsLimit,
                    isOverdue,
                    overdueInvoices,
                    requiresApproval: false,
                    warningMessage: errorMessage
                };
            case 'WARN':
                return {
                    allowed: true,
                    policy,
                    creditLimitMinor,
                    currentBalanceMinor,
                    newCreditMinor,
                    totalExposureMinor,
                    exceedsLimit,
                    isOverdue,
                    overdueInvoices,
                    requiresApproval: false,
                    warningMessage: errorMessage
                };
            case 'REQUIRE_APPROVAL':
                if (hasManagerApproval) {
                    return {
                        allowed: true,
                        policy,
                        creditLimitMinor,
                        currentBalanceMinor,
                        newCreditMinor,
                        totalExposureMinor,
                        exceedsLimit,
                        isOverdue,
                        overdueInvoices,
                        requiresApproval: false,
                        warningMessage: `Manager approval verified for credit limit exception: ${errorMessage}`
                    };
                }
                return {
                    allowed: false,
                    policy,
                    creditLimitMinor,
                    currentBalanceMinor,
                    newCreditMinor,
                    totalExposureMinor,
                    exceedsLimit,
                    isOverdue,
                    overdueInvoices,
                    requiresApproval: true,
                    errorMessage: `Supervisor approval required to proceed with credit sale. ${errorMessage}`
                };
            case 'BLOCK':
            default:
                if (exceedsLimit) {
                    throw new CreditLimitExceededError(errorMessage);
                }
                else {
                    throw new CustomerOverdueError(errorMessage);
                }
        }
    }
}
exports.CreditControlEvaluator = CreditControlEvaluator;
