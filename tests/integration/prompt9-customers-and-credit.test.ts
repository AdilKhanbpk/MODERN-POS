import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/infrastructure/sqlite/migrations/migration-runner';
import { CustomerService, DuplicateCustomerCodeError, PaymentAllocationError } from '../../src/application/services/CustomerService';
import { SalesService } from '../../src/application/services/SalesService';
import { ProductCatalogService } from '../../src/application/services/ProductCatalogService';
import { ProductRepository } from '../../src/infrastructure/sqlite/repositories/ProductRepository';
import { SaleRepository } from '../../src/infrastructure/sqlite/repositories/SaleRepository';
import { CustomerRepository } from '../../src/infrastructure/sqlite/repositories/CustomerRepository';
import { AccountRepository } from '../../src/infrastructure/sqlite/repositories/AccountRepository';
import {
  CreditLimitExceededError,
  CustomerOverdueError,
  CustomerInactiveError,
  WalkInCreditForbiddenError
} from '../../src/domain/customers/credit-control';

describe('Prompt 9 — Customer Management, Credit Limits & Ledger Allocations', () => {
  let db: Database.Database;
  let customerService: CustomerService;
  let salesService: SalesService;
  let catalogService: ProductCatalogService;

  const businessId = '00000000-0000-0000-0000-000000000001';
  const actor = { userId: '1', role: 'owner', businessId };

  let unitPieceId: any;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    const productRepo = new ProductRepository(db);
    const saleRepo = new SaleRepository(db);
    const customerRepo = new CustomerRepository(db);
    const accountRepo = new AccountRepository(db);

    customerService = new CustomerService(db);
    salesService = new SalesService(saleRepo, productRepo, customerRepo, accountRepo);
    catalogService = new ProductCatalogService(db);

    const unitRow = db.prepare("SELECT id FROM units WHERE name = 'Piece'").get() as { id: any };
    unitPieceId = unitRow.id;
  });

  // =========================================================================
  // 1. WALK-IN CUSTOMER HANDLING
  // =========================================================================
  describe('1. Walk-in Customer Handling', () => {
    it('seeds and retrieves dedicated walk-in customer record during onboarding', () => {
      const walkIn = customerService.getWalkInCustomer(businessId);
      expect(walkIn).toBeDefined();
      expect(walkIn.customerCode).toBe('WALK-IN');
      expect(walkIn.name).toBe('Walk-in Customer');
      expect(walkIn.customerType).toBe('retail');
      expect(walkIn.creditLimitMinor).toBe(0);
      expect(walkIn.isActive).toBe(true);
    });

    it('blocks charging credit sales to the dedicated walk-in customer', () => {
      const walkIn = customerService.getWalkInCustomer(businessId);

      expect(() => {
        customerService.checkCreditExposure(businessId, walkIn.id, 5000);
      }).toThrowError(WalkInCreditForbiddenError);
    });

    it('completes cash sales without requiring a customer to be explicitly registered', () => {
      const sugar = catalogService.createProduct({
        businessId,
        sku: 'SUGAR-1KG',
        name: 'White Refined Sugar 1kg',
        baseUnitId: unitPieceId,
        retailPriceMinor: 15000,
        openingStockScaled: 100,
        allowNegativeStock: true
      });

      // Cash sale with customerId omitted
      const sale = salesService.createSale({
        cashierId: 1,
        items: [
          {
            productId: sugar.id as any,
            quantity: 2,
            unitPrice: 15000,
            conversionFactor: 1
          }
        ],
        amountPaid: 30000,
        paymentMethod: 'CASH' as any
      });

      expect(sale).toBeDefined();
      expect(sale.grandTotal).toBe(30000);
      expect(sale.paymentMethod).toBe('CASH');

      // Check that customerId was resolved to the Walk-in customer rather than remaining null
      const walkIn = customerService.getWalkInCustomer(businessId);
      expect(String(sale.customerId)).toBe(String(walkIn.id));
    });
  });

  // =========================================================================
  // 2. CUSTOMER CREATION, OPENING BALANCE & IMMUTABILITY
  // =========================================================================
  describe('2. Customer Accounts & Opening Balance', () => {
    it('creates customer with dated opening balance recorded in ledger', () => {
      const customer = customerService.createCustomer(
        {
          businessId,
          customerCode: 'CUST-AHMAD-01',
          name: 'Ahmad Traders',
          phone: '03001234567',
          customerType: 'wholesale',
          creditLimitMinor: 5000000, // Rs. 50,000 credit limit
          creditDays: 30,
          openingBalanceMinor: 1200000 // Rs. 12,000 opening dues
        },
        actor
      );

      expect(customer.id).toBeDefined();
      expect(customer.customerCode).toBe('CUST-AHMAD-01');
      expect(customer.creditLimitMinor).toBe(5000000);
      expect(customer.openingBalanceMinor).toBe(1200000);

      // Verify that opening balance created an authoritative ledger entry
      const statement = customerService.getCustomerStatement(businessId, customer.id);
      expect(statement.entries).toHaveLength(1);
      expect(statement.entries[0].entryType).toBe('OPENING_BALANCE');
      expect(statement.entries[0].debitMinor).toBe(1200000);
      expect(statement.entries[0].creditMinor).toBe(0);
      expect(statement.closingBalanceMinor).toBe(1200000);
      expect(statement.isReconciled).toBe(true);

      // Verify customer display balance matches authoritative ledger sum
      expect(customer.calculatedBalanceMinor).toBe(1200000);
    });

    it('enforces unique customer_code constraint within the business', () => {
      customerService.createCustomer(
        {
          businessId,
          customerCode: 'UNIQUE-CUST-10',
          name: 'First Customer',
          phone: '03001111111'
        },
        actor
      );

      expect(() => {
        customerService.createCustomer(
          {
            businessId,
            customerCode: 'UNIQUE-CUST-10',
            name: 'Duplicate Customer',
            phone: '03002222222'
          },
          actor
        );
      }).toThrowError(DuplicateCustomerCodeError);
    });

    it('strictly forbids UI from directly altering calculated ledger balance', () => {
      const customer = customerService.createCustomer(
        {
          businessId,
          customerCode: 'CUST-NO-ALTER',
          name: 'Immutable Customer',
          openingBalanceMinor: 50000
        },
        actor
      );

      // Attempting to update customer without ledger transaction does not change calculated balance
      customerService.updateCustomer(
        customer.id,
        {
          name: 'Immutable Customer Renamed'
        },
        actor
      );

      const refreshed = customerService.getCustomerById(businessId, customer.id);
      expect(refreshed?.name).toBe('Immutable Customer Renamed');
      expect(refreshed?.calculatedBalanceMinor).toBe(50000);
    });
  });

  // =========================================================================
  // 3. CREDIT SALES & CREDIT CONTROL POLICIES
  // =========================================================================
  describe('3. Credit Sales & Exposure Control', () => {
    it('blocks credit sale when credit limit is exceeded under BLOCK policy', () => {
      // Set credit limit: Rs. 20,000 (2,000,000 paisa)
      const customer = customerService.createCustomer(
        {
          businessId,
          customerCode: 'CUST-CREDIT-01',
          name: 'Credit Test Customer',
          creditLimitMinor: 2000000,
          creditDays: 15,
          openingBalanceMinor: 1500000 // Already owes Rs. 15,000
        },
        actor
      );

      // Attempting new credit of Rs. 4,000 -> Total: Rs. 19,000 <= 20,000 (Allowed)
      const checkWithin = customerService.checkCreditExposure(businessId, customer.id, 400000);
      expect(checkWithin.allowed).toBe(true);
      expect(checkWithin.totalExposureMinor).toBe(1900000);

      // Attempting new credit of Rs. 8,000 -> Total: Rs. 23,000 > 20,000 (Blocked)
      expect(() => {
        customerService.checkCreditExposure(businessId, customer.id, 800000);
      }).toThrowError(CreditLimitExceededError);
    });

    it('requires supervisor approval when policy is REQUIRE_APPROVAL and allows override', () => {
      // Set policy: REQUIRE_APPROVAL
      db.prepare(`
        UPDATE businesses
        SET credit_policy = 'REQUIRE_APPROVAL'
        WHERE id = ?
      `).run(businessId);

      const customer = customerService.createCustomer(
        {
          businessId,
          customerCode: 'CUST-APPROVAL-01',
          name: 'Approval Needed Customer',
          creditLimitMinor: 1000000 // Rs. 10,000 limit
        },
        actor
      );

      // Attempt credit of Rs. 15,000 without manager approval
      const checkNoApproval = customerService.checkCreditExposure(businessId, customer.id, 1500000, false);
      expect(checkNoApproval.allowed).toBe(false);
      expect(checkNoApproval.requiresApproval).toBe(true);
      expect(checkNoApproval.errorMessage).toContain('Supervisor approval required');

      // Attempt credit of Rs. 15,000 WITH manager approval
      const checkApproved = customerService.checkCreditExposure(businessId, customer.id, 1500000, true);
      expect(checkApproved.allowed).toBe(true);
      expect(checkApproved.requiresApproval).toBe(false);
      expect(checkApproved.warningMessage).toContain('Manager approval verified');
    });

    it('allows credit sale with warning when policy is WARN', () => {
      // Set policy: WARN
      db.prepare(`
        UPDATE businesses
        SET credit_policy = 'WARN'
        WHERE id = ?
      `).run(businessId);

      const customer = customerService.createCustomer(
        {
          businessId,
          customerCode: 'CUST-WARN-01',
          name: 'Warning Policy Customer',
          creditLimitMinor: 500000
        },
        actor
      );

      const checkWarn = customerService.checkCreditExposure(businessId, customer.id, 800000);
      expect(checkWarn.allowed).toBe(true);
      expect(checkWarn.exceedsLimit).toBe(true);
      expect(checkWarn.warningMessage).toContain('Credit limit exceeded');
    });

    it('strictly forbids credit transactions for inactive customers', () => {
      const customer = customerService.createCustomer(
        {
          businessId,
          customerCode: 'CUST-INACTIVE-01',
          name: 'Archived Customer',
          creditLimitMinor: 1000000,
          isActive: false
        },
        actor
      );

      expect(() => {
        customerService.checkCreditExposure(businessId, customer.id, 100000);
      }).toThrowError(CustomerInactiveError);
    });
  });

  // =========================================================================
  // 4. PARTIAL PAYMENTS & MULTI-DOCUMENT ALLOCATIONS
  // =========================================================================
  describe('4. Partial Payments & Payment Allocations', () => {
    it('executes prompt example: Sale 10,000; Pay 4,000 -> 6,000 due; Pay 3,000 -> 3,000 due', () => {
      const customer = customerService.createCustomer(
        {
          businessId,
          customerCode: 'CUST-ALLOC-EX',
          name: 'Allocation Example Customer',
          creditLimitMinor: 5000000
        },
        actor
      );

      // Create product
      const item = catalogService.createProduct({
        businessId,
        sku: 'ITEM-TEST-01',
        name: 'Test Retail Item',
        baseUnitId: unitPieceId,
        retailPriceMinor: 1000000, // Rs. 10,000
        openingStockScaled: 100,
        allowNegativeStock: true
      });

      // Post credit sale: Total = Rs. 10,000 (1,000,000 paisa), Amount paid = 0
      const sale = salesService.createSale({
        cashierId: 1,
        customerId: customer.id as any,
        items: [{ productId: item.id as any, quantity: 1, unitPrice: 1000000, conversionFactor: 1 }],
        amountPaid: 0,
        isCredit: true
      });

      // Outstanding check before payment
      let invoices = customerService.getOutstandingInvoices(businessId, customer.id);
      expect(invoices).toHaveLength(1);
      expect(invoices[0].totalMinor).toBe(1000000);
      expect(invoices[0].paidMinor).toBe(0);
      expect(invoices[0].outstandingMinor).toBe(1000000); // Rs. 10,000 due

      // Customer payment 1: Rs. 4,000 (400,000 paisa) allocated to this invoice
      const pay1 = customerService.recordCustomerPayment(
        {
          businessId,
          customerId: customer.id,
          amountMinor: 400000,
          allocations: [{ salesDocumentId: sale.id, amountMinor: 400000 }]
        },
        actor
      );

      expect(pay1.advanceCreditMinor).toBe(0);

      // Outstanding check after payment 1
      invoices = customerService.getOutstandingInvoices(businessId, customer.id);
      expect(invoices).toHaveLength(1);
      expect(invoices[0].paidMinor).toBe(400000);
      expect(invoices[0].outstandingMinor).toBe(600000); // Rs. 6,000 due

      // Customer payment 2: Rs. 3,000 (300,000 paisa) allocated to this invoice
      const pay2 = customerService.recordCustomerPayment(
        {
          businessId,
          customerId: customer.id,
          amountMinor: 300000,
          allocations: [{ salesDocumentId: sale.id, amountMinor: 300000 }]
        },
        actor
      );

      expect(pay2.advanceCreditMinor).toBe(0);

      // Outstanding check after payment 2
      invoices = customerService.getOutstandingInvoices(businessId, customer.id);
      expect(invoices).toHaveLength(1);
      expect(invoices[0].paidMinor).toBe(700000);
      expect(invoices[0].outstandingMinor).toBe(300000); // Exactly Rs. 3,000 due

      // Final ledger balance check
      const currentBalance = customerService.calculateLedgerBalance(customer.id);
      expect(currentBalance).toBe(300000); // Rs. 3,000 remains owed
    });

    it('rejects allocations greater than payment amount or document remaining due', () => {
      const customer = customerService.createCustomer(
        {
          businessId,
          customerCode: 'CUST-OVER-ALLOC',
          name: 'Over Allocation Customer',
          creditLimitMinor: 5000000
        },
        actor
      );

      const prod = catalogService.createProduct({
        businessId,
        sku: 'PROD-ALLOC-CHECK',
        name: 'Alloc Check Product',
        baseUnitId: unitPieceId,
        retailPriceMinor: 500000, // Rs. 5,000
        openingStockScaled: 100,
        allowNegativeStock: true
      });

      const sale = salesService.createSale({
        cashierId: 1,
        customerId: customer.id as any,
        items: [{ productId: prod.id as any, quantity: 1, unitPrice: 500000, conversionFactor: 1 }],
        amountPaid: 0,
        isCredit: true
      });

      // 1. Trying to allocate Rs. 6,000 against a Rs. 5,000 invoice
      expect(() => {
        customerService.recordCustomerPayment(
          {
            businessId,
            customerId: customer.id,
            amountMinor: 1000000,
            allocations: [{ salesDocumentId: sale.id, amountMinor: 600000 }]
          },
          actor
        );
      }).toThrowError(PaymentAllocationError);

      // 2. Trying to allocate Rs. 4,000 when payment amount is only Rs. 2,000
      expect(() => {
        customerService.recordCustomerPayment(
          {
            businessId,
            customerId: customer.id,
            amountMinor: 200000,
            allocations: [{ salesDocumentId: sale.id, amountMinor: 400000 }]
          },
          actor
        );
      }).toThrowError(/exceeds available payment amount/);
    });

    it('supports unallocated advance payments that reduce customer balance', () => {
      const customer = customerService.createCustomer(
        {
          businessId,
          customerCode: 'CUST-ADV-01',
          name: 'Advance Payer Customer',
          openingBalanceMinor: 200000 // Owed Rs. 2,000
        },
        actor
      );

      // Customer deposits Rs. 5,000 without allocating to specific invoices
      const advancePay = customerService.recordCustomerPayment(
        {
          businessId,
          customerId: customer.id,
          amountMinor: 500000 // Rs. 5,000
        },
        actor
      );

      expect(advancePay.advanceCreditMinor).toBe(500000);

      // Current balance: 2,000 - 5,000 = -3,000 (Customer has Rs. 3,000 advance credit)
      const balance = customerService.calculateLedgerBalance(customer.id);
      expect(balance).toBe(-300000);

      // Ledger statement verifies credit entry
      const statement = customerService.getCustomerStatement(businessId, customer.id);
      expect(statement.entries).toHaveLength(2);
      expect(statement.closingBalanceMinor).toBe(-300000);
      expect(statement.isReconciled).toBe(true);
    });
  });

  // =========================================================================
  // 5. OVERDUE INVOICES & STATEMENT RECONCILIATION
  // =========================================================================
  describe('5. Overdue Invoices & Statement Reconciliation', () => {
    it('detects overdue documents when invoice date exceeds credit_days', () => {
      const customer = customerService.createCustomer(
        {
          businessId,
          customerCode: 'CUST-OVERDUE-01',
          name: 'Overdue Test Customer',
          creditLimitMinor: 1000000,
          creditDays: 7 // 7 days credit
        },
        actor
      );

      const prod = catalogService.createProduct({
        businessId,
        sku: 'PROD-EXP',
        name: 'Overdue Prod',
        baseUnitId: unitPieceId,
        retailPriceMinor: 200000,
        openingStockScaled: 100,
        allowNegativeStock: true
      });

      const sale = salesService.createSale({
        cashierId: 1,
        customerId: customer.id as any,
        items: [{ productId: prod.id as any, quantity: 1, unitPrice: 200000, conversionFactor: 1 }],
        amountPaid: 0,
        isCredit: true
      });

      // Initially not overdue (0 days old <= 7 credit days)
      let invoices = customerService.getOutstandingInvoices(businessId, customer.id);
      expect(invoices[0].isOverdue).toBe(false);

      // Simulate passage of 10 days by backdating the sale record
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare('UPDATE sales SET created_at = ? WHERE id = ?').run(tenDaysAgo, sale.id);

      invoices = customerService.getOutstandingInvoices(businessId, customer.id);
      expect(invoices[0].isOverdue).toBe(true);
      expect(invoices[0].overdueDays).toBeGreaterThanOrEqual(3);

      // Under BLOCK policy, customer is blocked due to overdue invoice
      expect(() => {
        customerService.checkCreditExposure(businessId, customer.id, 50000);
      }).toThrowError(CustomerOverdueError);
    });

    it('generates chronological statement with running balance and reconciles to 0 discrepancy', () => {
      const customer = customerService.createCustomer(
        {
          businessId,
          customerCode: 'CUST-STMT-01',
          name: 'Statement Reconciliation Customer',
          creditLimitMinor: 5000000,
          openingBalanceMinor: 100000 // +1,000
        },
        actor
      );

      // Transaction 1: Credit sale of Rs. 4,000 (+4,000 -> Running: 5,000)
      customerService.recordCustomerLedgerEntry(
        {
          businessId,
          customerId: customer.id,
          entryType: 'CREDIT_SALE',
          referenceType: 'SALE',
          referenceId: '101',
          debitMinor: 400000,
          description: 'Invoice #101'
        },
        actor
      );

      // Transaction 2: Customer payment of Rs. 2,000 (-2,000 -> Running: 3,000)
      customerService.recordCustomerLedgerEntry(
        {
          businessId,
          customerId: customer.id,
          entryType: 'PAYMENT_RECEIVED',
          referenceType: 'PAYMENT',
          referenceId: '201',
          creditMinor: 200000,
          description: 'Payment #201'
        },
        actor
      );

      // Transaction 3: Sales return of Rs. 500 (-500 -> Running: 2,500)
      customerService.recordCustomerLedgerEntry(
        {
          businessId,
          customerId: customer.id,
          entryType: 'SALE_RETURN',
          referenceType: 'RETURN',
          referenceId: '301',
          creditMinor: 50000,
          description: 'Credit Note #301'
        },
        actor
      );

      const statement = customerService.getCustomerStatement(businessId, customer.id);

      expect(statement.entries).toHaveLength(4);
      expect(statement.entries[0].runningBalanceMinor).toBe(100000); // 1,000
      expect(statement.entries[1].runningBalanceMinor).toBe(500000); // 5,000
      expect(statement.entries[2].runningBalanceMinor).toBe(300000); // 3,000
      expect(statement.entries[3].runningBalanceMinor).toBe(250000); // 2,500

      expect(statement.totalDebitsMinor).toBe(500000); // 1,000 + 4,000
      expect(statement.totalCreditsMinor).toBe(250000); // 2,000 + 500
      expect(statement.closingBalanceMinor).toBe(250000); // 2,500
      expect(statement.isReconciled).toBe(true);
      expect(statement.discrepancyMinor).toBe(0);

      // Verify reconciliation tool confirms 0 discrepancy
      const recon = customerService.reconcileCustomerBalance(businessId, customer.id);
      expect(recon.isReconciled).toBe(true);
      expect(recon.discrepancy).toBe(0);
      expect(recon.ledgerBalance).toBe(250000);
      expect(recon.cachedBalance).toBe(250000);
    });
  });
});
