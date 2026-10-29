import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/infrastructure/sqlite/migrations/migration-runner';
import { SupplierService } from '../../src/application/services/SupplierService';
import { PurchaseService } from '../../src/application/services/PurchaseService';
import { PurchaseRepository } from '../../src/infrastructure/sqlite/repositories/PurchaseRepository';
import { ProductRepository } from '../../src/infrastructure/sqlite/repositories/ProductRepository';
import { SupplierRepository } from '../../src/infrastructure/sqlite/repositories/SupplierRepository';
import { AccountRepository } from '../../src/infrastructure/sqlite/repositories/AccountRepository';
import {
  SupplierBalanceCalculator,
  InactiveSupplierError,
  SupplierBalanceError,
  PaymentReversalError
} from '../../src/domain/suppliers/supplier-balance';

describe('Prompt 10 — Supplier Management, Accounts Payable & Ledger Tracking', () => {
  let db: Database.Database;
  let supplierService: SupplierService;
  let purchaseService: PurchaseService;
  let supplierRepo: SupplierRepository;
  let productRepo: ProductRepository;

  const businessId = '00000000-0000-0000-0000-000000000001';
  const branchId = '00000000-0000-0000-0000-000000000002';
  const actor = { userId: '1', role: 'owner', businessId, branchId };

  let testProductId: number | string;

  beforeEach(() => {
    // Fresh in-memory SQLite database with all 12 migrations
    db = new Database(':memory:');
    runMigrations(db);

    supplierService = new SupplierService(db);
    supplierRepo = new SupplierRepository(db);
    productRepo = new ProductRepository(db);
    const purchaseRepo = new PurchaseRepository(db);
    const accountRepo = new AccountRepository(db);

    purchaseService = new PurchaseService(purchaseRepo, productRepo, supplierRepo, accountRepo);

    // Create a standard test product for purchase orders
    testProductId = productRepo.create({
      id: 101,
      name: 'Sunflower Cooking Oil 1L',
      sku: 'OIL-1L-001',
      costPrice: 50000, // Rs. 500.00
      sellingPrice: 65000, // Rs. 650.00
      currentStock: 10,
      isActive: true
    });
  });

  // =========================================================================
  // 1. SUPPLIER REGISTRATION & OPENING BALANCE
  // =========================================================================
  describe('1. Supplier Database & Opening Balance', () => {
    it('creates supplier with unique supplier_code and records dated opening balance in ledger', () => {
      const supplier = supplierService.createSupplier(
        {
          businessId,
          supplierCode: 'SUP-NESTLE',
          name: 'Nestlé Pakistan Ltd.',
          contactPerson: 'Tariq Mehmood',
          phone: '0300-1122334',
          email: 'tariq@nestle.com.pk',
          paymentTermsDays: 30,
          creditLimitMinor: 50000000, // Rs. 500,000 limit
          openingBalanceMinor: 15000000, // Rs. 150,000 opening payable (Credit)
          notes: 'Primary beverages and dairy vendor'
        },
        actor
      );

      expect(supplier.id).toBeDefined();
      expect(supplier.supplierCode).toBe('SUP-NESTLE');
      expect(supplier.name).toBe('Nestlé Pakistan Ltd.');
      expect(supplier.paymentTermsDays).toBe(30);

      // Authoritative balance must equal opening balance
      expect(supplier.balance).toBe(15000000);

      // Verify ledger has exactly 1 entry with CREDIT convention
      const statement = supplierService.getSupplierStatement(supplier.id);
      expect(statement.entries.length).toBe(1);
      expect(statement.entries[0].entryType).toBe('OPENING_BALANCE');
      expect(statement.entries[0].creditMinor).toBe(15000000);
      expect(statement.entries[0].debitMinor).toBe(0);
      expect(statement.entries[0].runningBalanceMinor).toBe(15000000);
    });

    it('enforces unique (business_id, supplier_code) constraint', () => {
      supplierService.createSupplier(
        {
          businessId,
          supplierCode: 'SUP-DALDA',
          name: 'Dalda Foods Pvt Ltd',
          phone: '0321-9988776'
        },
        actor
      );

      // Attempt duplicate code in same business must fail
      expect(() => {
        supplierService.createSupplier(
          {
            businessId,
            supplierCode: 'SUP-DALDA',
            name: 'Another Dalda Distributor',
            phone: '0321-1111111'
          },
          actor
        );
      }).toThrowError(/already exists/i);
    });

    it('strictly forbids manual updating of calculated supplier balance', () => {
      const supplier = supplierService.createSupplier(
        {
          businessId,
          supplierCode: 'SUP-UNILEVER',
          name: 'Unilever Pakistan',
          openingBalanceMinor: 2000000 // Rs. 20,000
        },
        actor
      );

      expect(supplier.balance).toBe(2000000);

      // Updating contact details must NOT alter the balance
      const updated = supplierService.updateSupplier(
        supplier.id,
        {
          contactPerson: 'Ali Raza',
          phone: '0301-4455667'
        },
        actor
      );

      expect(updated.contactPerson).toBe('Ali Raza');
      expect(updated.balance).toBe(2000000);
    });
  });

  // =========================================================================
  // 2. PURCHASES: CASH VS CREDIT PURCHASES
  // =========================================================================
  describe('2. Cash vs Credit Purchases', () => {
    it('increases supplier payable on credit purchase (Credit Convention)', () => {
      const supplier = supplierService.createSupplier(
        {
          businessId,
          supplierCode: 'SUP-ENGRO',
          name: 'Engro Foods',
          paymentTermsDays: 15
        },
        actor
      );

      expect(supplier.balance).toBe(0);

      // 10 units @ Rs. 500 = Rs. 5,000 total (500,000 paisa)
      // Credit purchase: amountPaid = 0
      purchaseService.createPurchaseOrder({
        supplierId: supplier.id,
        invoiceNumber: 'ENG-BILL-101',
        items: [
          {
            productId: Number(testProductId),
            quantity: 10,
            conversionFactor: 1,
            unitCostPrice: 50000,
            sellingPrice: 65000,
            lineTotal: 500000
          }
        ],
        additionalCost: 0,
        amountPaid: 0,
        isCredit: true
      });

      // Supplier payable must increase by full bill amount: Rs. 5,000
      const currentBalance = supplierService.calculateLedgerBalance(supplier.id);
      expect(currentBalance).toBe(500000);

      // Check outstanding invoices list
      const outstanding = supplierService.getOutstandingPurchaseInvoices(supplier.id, businessId);
      expect(outstanding.length).toBe(1);
      expect(outstanding[0].totalMinor).toBe(500000);
      expect(outstanding[0].remainingDueMinor).toBe(500000);
      expect(outstanding[0].isOverdue).toBe(false);
    });

    it('does not inflate unpaid payable balance on fully paid cash purchase', () => {
      const supplier = supplierService.createSupplier(
        {
          businessId,
          supplierCode: 'SUP-NATIONAL',
          name: 'National Foods'
        },
        actor
      );

      // Cash purchase: amountPaid = grandTotal
      purchaseService.createPurchaseOrder({
        supplierId: supplier.id,
        invoiceNumber: 'NAT-CASH-501',
        items: [
          {
            productId: Number(testProductId),
            quantity: 5,
            conversionFactor: 1,
            unitCostPrice: 50000,
            sellingPrice: 65000,
            lineTotal: 250000
          }
        ],
        additionalCost: 0,
        amountPaid: 250000
      });

      // Balance must remain exactly 0 (Credit bill 250,000 - Debit payment 250,000 = 0)
      const balance = supplierService.calculateLedgerBalance(supplier.id);
      expect(balance).toBe(0);

      const outstanding = supplierService.getOutstandingPurchaseInvoices(supplier.id, businessId);
      // Fully paid bills do not have remaining due > 0
      expect(outstanding.length).toBe(0);
    });
  });

  // =========================================================================
  // 3. PARTIAL PAYMENTS & MULTI-PURCHASE ALLOCATIONS
  // =========================================================================
  describe('3. Partial Payments & Payment Allocations', () => {
    it('handles prompt example: Purchase 10,000; Pay 4,000 -> 6,000 due; Pay 3,000 -> 3,000 due', () => {
      const supplier = supplierService.createSupplier(
        {
          businessId,
          supplierCode: 'SUP-KRAFT',
          name: 'Kraft Foods Pakistan'
        },
        actor
      );

      // Bill of Rs. 10,000 (1,000,000 paisa)
      const poId = purchaseService.createPurchaseOrder({
        supplierId: supplier.id,
        invoiceNumber: 'KRAFT-BILL-01',
        items: [
          {
            productId: Number(testProductId),
            quantity: 20,
            conversionFactor: 1,
            unitCostPrice: 50000,
            sellingPrice: 65000,
            lineTotal: 1000000
          }
        ],
        additionalCost: 0,
        amountPaid: 0,
        isCredit: true
      });

      expect(supplierService.calculateLedgerBalance(supplier.id)).toBe(1000000);

      // 1st Partial Payment: Disburse Rs. 4,000 (400,000 paisa) allocated to KRAFT-BILL-01
      const pay1 = supplierService.recordSupplierPayment(
        {
          supplierId: supplier.id,
          amountMinor: 400000,
          paymentMethod: 'BANK_TRANSFER',
          referenceNumber: 'TXN-001',
          allocations: [
            {
              purchaseDocumentId: poId,
              allocatedMinor: 400000
            }
          ]
        },
        actor
      );

      expect(pay1.totalAllocated).toBe(400000);
      expect(pay1.unallocatedAdvance).toBe(0);
      expect(pay1.newBalance).toBe(600000);

      let outstanding = supplierService.getOutstandingPurchaseInvoices(supplier.id, businessId);
      expect(outstanding[0].remainingDueMinor).toBe(600000);

      // 2nd Partial Payment: Disburse Rs. 3,000 (300,000 paisa) allocated to KRAFT-BILL-01
      const pay2 = supplierService.recordSupplierPayment(
        {
          supplierId: supplier.id,
          amountMinor: 300000,
          paymentMethod: 'CHEQUE',
          referenceNumber: 'CHQ-8822',
          allocations: [
            {
              purchaseDocumentId: poId,
              allocatedMinor: 300000
            }
          ]
        },
        actor
      );

      expect(pay2.totalAllocated).toBe(300000);
      expect(pay2.newBalance).toBe(300000);

      outstanding = supplierService.getOutstandingPurchaseInvoices(supplier.id, businessId);
      expect(outstanding[0].remainingDueMinor).toBe(300000);
    });

    it('allocates a single payment across multiple purchase documents', () => {
      const supplier = supplierService.createSupplier(
        {
          businessId,
          supplierCode: 'SUP-SHAN',
          name: 'Shan Foods Ltd.'
        },
        actor
      );

      // Bill 1: Rs. 5,000 (500,000 paisa)
      const po1 = purchaseService.createPurchaseOrder({
        supplierId: supplier.id,
        invoiceNumber: 'SHAN-INV-1',
        items: [
          {
            productId: Number(testProductId),
            quantity: 10,
            conversionFactor: 1,
            unitCostPrice: 50000,
            sellingPrice: 65000,
            lineTotal: 500000
          }
        ],
        additionalCost: 0,
        amountPaid: 0
      });

      // Bill 2: Rs. 7,000 (700,000 paisa)
      const po2 = purchaseService.createPurchaseOrder({
        supplierId: supplier.id,
        invoiceNumber: 'SHAN-INV-2',
        items: [
          {
            productId: Number(testProductId),
            quantity: 14,
            conversionFactor: 1,
            unitCostPrice: 50000,
            sellingPrice: 65000,
            lineTotal: 700000
          }
        ],
        additionalCost: 0,
        amountPaid: 0
      });

      expect(supplierService.calculateLedgerBalance(supplier.id)).toBe(1200000);

      // Single payment of Rs. 10,000:
      // Rs. 5,000 to Bill 1 (fully settles Bill 1)
      // Rs. 5,000 to Bill 2 (leaves Rs. 2,000 due on Bill 2)
      const pay = supplierService.recordSupplierPayment(
        {
          supplierId: supplier.id,
          amountMinor: 1000000,
          paymentMethod: 'ONLINE',
          allocations: [
            { purchaseDocumentId: po1, allocatedMinor: 500000 },
            { purchaseDocumentId: po2, allocatedMinor: 500000 }
          ]
        },
        actor
      );

      expect(pay.newBalance).toBe(200000);

      const outstanding = supplierService.getOutstandingPurchaseInvoices(supplier.id, businessId);
      expect(outstanding.length).toBe(1);
      expect(outstanding[0].purchaseId).toBe(po2);
      expect(outstanding[0].remainingDueMinor).toBe(200000);
    });

    it('rejects allocations greater than document remaining due or payment amount', () => {
      const supplier = supplierService.createSupplier(
        {
          businessId,
          supplierCode: 'SUP-COLGATE',
          name: 'Colgate-Palmolive'
        },
        actor
      );

      const poId = purchaseService.createPurchaseOrder({
        supplierId: supplier.id,
        invoiceNumber: 'COL-001',
        items: [
          {
            productId: Number(testProductId),
            quantity: 4,
            conversionFactor: 1,
            unitCostPrice: 50000,
            sellingPrice: 65000,
            lineTotal: 200000
          }
        ],
        additionalCost: 0,
        amountPaid: 0
      });

      // 1. Allocation exceeds document remaining due (Bill is 200,000, attempting 250,000)
      expect(() => {
        supplierService.recordSupplierPayment(
          {
            supplierId: supplier.id,
            amountMinor: 250000,
            paymentMethod: 'CASH',
            allocations: [{ purchaseDocumentId: poId, allocatedMinor: 250000 }]
          },
          actor
        );
      }).toThrowError(/remaining due is only 200000/i);

      // 2. Sum of allocations exceeds total payment amount
      expect(() => {
        supplierService.recordSupplierPayment(
          {
            supplierId: supplier.id,
            amountMinor: 100000,
            paymentMethod: 'CASH',
            allocations: [{ purchaseDocumentId: poId, allocatedMinor: 150000 }]
          },
          actor
        );
      }).toThrowError(/cannot exceed payment amount/i);
    });

    it('supports unallocated advance payments that reduce supplier payable balance', () => {
      const supplier = supplierService.createSupplier(
        {
          businessId,
          supplierCode: 'SUP-RECKITT',
          name: 'Reckitt Benckiser'
        },
        actor
      );

      expect(supplier.balance).toBe(0);

      // Pay Rs. 50,000 advance without any purchase bill yet
      const pay = supplierService.recordSupplierPayment(
        {
          supplierId: supplier.id,
          amountMinor: 5000000,
          paymentMethod: 'BANK_TRANSFER',
          notes: 'Advance deposit for upcoming bulk shipment'
        },
        actor
      );

      expect(pay.totalAllocated).toBe(0);
      expect(pay.unallocatedAdvance).toBe(5000000);

      // In Accounts Payable, an advance debit creates a negative payable balance (supplier owes us)
      expect(pay.newBalance).toBe(-5000000);
      expect(supplierService.calculateLedgerBalance(supplier.id)).toBe(-5000000);
    });
  });

  // =========================================================================
  // 4. RETURNS, PAYMENT REVERSALS & INACTIVE SUPPLIERS
  // =========================================================================
  describe('4. Returns, Reversals & Inactive Supplier Guards', () => {
    it('decreases supplier payable on supplier return (Debit Convention)', () => {
      const supplier = supplierService.createSupplier(
        {
          businessId,
          supplierCode: 'SUP-DAWN',
          name: 'Dawn Bread'
        },
        actor
      );

      // Purchase bill of Rs. 10,000
      purchaseService.createPurchaseOrder({
        supplierId: supplier.id,
        invoiceNumber: 'DAWN-B1',
        items: [
          {
            productId: Number(testProductId),
            quantity: 20,
            conversionFactor: 1,
            unitCostPrice: 50000,
            sellingPrice: 65000,
            lineTotal: 1000000
          }
        ],
        additionalCost: 0,
        amountPaid: 0
      });

      expect(supplierService.calculateLedgerBalance(supplier.id)).toBe(1000000);

      // Return defective stock worth Rs. 2,500 (250,000 paisa)
      supplierService.recordSupplierReturn(
        {
          supplierId: supplier.id,
          amountMinor: 250000,
          reason: 'Damaged packaging in transit'
        },
        actor
      );

      // Balance must decrease to Rs. 7,500 (750,000 paisa)
      expect(supplierService.calculateLedgerBalance(supplier.id)).toBe(750000);

      const statement = supplierService.getSupplierStatement(supplier.id);
      expect(statement.totalReturnsMinor).toBe(250000);
      expect(statement.closingBalanceMinor).toBe(750000);
    });

    it('reverses a disbursed payment, voids allocations, and restores original payable balance', () => {
      const supplier = supplierService.createSupplier(
        {
          businessId,
          supplierCode: 'SUP-KIMS',
          name: 'Kim’s Confectionery'
        },
        actor
      );

      // Bill: Rs. 8,000
      const poId = purchaseService.createPurchaseOrder({
        supplierId: supplier.id,
        invoiceNumber: 'KIMS-99',
        items: [
          {
            productId: Number(testProductId),
            quantity: 16,
            conversionFactor: 1,
            unitCostPrice: 50000,
            sellingPrice: 65000,
            lineTotal: 800000
          }
        ],
        additionalCost: 0,
        amountPaid: 0
      });

      expect(supplierService.calculateLedgerBalance(supplier.id)).toBe(800000);

      // Pay Rs. 5,000 via cheque
      const pay = supplierService.recordSupplierPayment(
        {
          supplierId: supplier.id,
          amountMinor: 500000,
          paymentMethod: 'CHEQUE',
          referenceNumber: 'CHQ-5501',
          allocations: [{ purchaseDocumentId: poId, allocatedMinor: 500000 }]
        },
        actor
      );

      expect(pay.newBalance).toBe(300000);

      // Supplier cheque bounces! Reverse payment with reason
      supplierService.reverseSupplierPayment(
        pay.paymentId,
        'Cheque returned unpaid by bank due to drawer signature mismatch',
        actor
      );

      // Authoritative payable balance must be fully restored to Rs. 8,000!
      expect(supplierService.calculateLedgerBalance(supplier.id)).toBe(800000);

      // Outstanding invoice due amount must be restored to Rs. 8,000
      const outstanding = supplierService.getOutstandingPurchaseInvoices(supplier.id, businessId);
      expect(outstanding[0].remainingDueMinor).toBe(800000);

      // Cannot reverse an already reversed payment
      expect(() => {
        supplierService.reverseSupplierPayment(pay.paymentId, 'Duplicate attempt', actor);
      }).toThrowError(PaymentReversalError);
    });

    it('strictly forbids purchases and disbursements for inactive suppliers', () => {
      const supplier = supplierService.createSupplier(
        {
          businessId,
          supplierCode: 'SUP-INACTIVE',
          name: 'Archived Packaging Vendor',
          isActive: false
        },
        actor
      );

      // 1. Purchase blocked
      expect(() => {
        purchaseService.createPurchaseOrder({
          supplierId: supplier.id,
          invoiceNumber: 'BLOCKED-PO',
          items: [
            {
              productId: Number(testProductId),
              quantity: 1,
              conversionFactor: 1,
              unitCostPrice: 50000,
              sellingPrice: 65000,
              lineTotal: 50000
            }
          ],
          additionalCost: 0,
          amountPaid: 0
        });
      }).toThrowError(/inactive supplier/i);

      // 2. Payment disbursement blocked
      expect(() => {
        supplierService.recordSupplierPayment(
          {
            supplierId: supplier.id,
            amountMinor: 100000,
            paymentMethod: 'CASH'
          },
          actor
        );
      }).toThrowError(InactiveSupplierError);
    });
  });

  // =========================================================================
  // 5. STATEMENTS, OVERDUE INVOICES & LEDGER RECONCILIATION
  // =========================================================================
  describe('5. Statements, Overdue Invoices & Reconciliation', () => {
    it('detects overdue purchase invoices based on payment_terms_days', () => {
      const supplier = supplierService.createSupplier(
        {
          businessId,
          supplierCode: 'SUP-TERMS',
          name: 'Terms Testing Vendor',
          paymentTermsDays: 7 // 7 days net credit
        },
        actor
      );

      const poId = purchaseService.createPurchaseOrder({
        supplierId: supplier.id,
        invoiceNumber: 'OLD-PO-01',
        items: [
          {
            productId: Number(testProductId),
            quantity: 2,
            conversionFactor: 1,
            unitCostPrice: 50000,
            sellingPrice: 65000,
            lineTotal: 100000
          }
        ],
        additionalCost: 0,
        amountPaid: 0
      });

      // Backdate the purchase by 10 days in the database
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare('UPDATE purchases SET created_at = ? WHERE id = ?').run(tenDaysAgo, poId);
      db.prepare('UPDATE purchase_orders SET created_at = ? WHERE id = ?').run(tenDaysAgo, poId);

      const outstanding = supplierService.getOutstandingPurchaseInvoices(supplier.id, businessId);
      expect(outstanding.length).toBe(1);
      expect(outstanding[0].isOverdue).toBe(true);
      expect(outstanding[0].overdueDays).toBeGreaterThanOrEqual(3);
    });

    it('generates chronological statement with running balance and reconciles to 0 discrepancy', () => {
      const supplier = supplierService.createSupplier(
        {
          businessId,
          supplierCode: 'SUP-RECON',
          name: 'Reconciliation Testing Vendor',
          openingBalanceMinor: 1000000 // Opening: +10,000 (100,000 paisa)
        },
        actor
      );

      // 1. Purchase Bill (+20,000)
      purchaseService.createPurchaseOrder({
        supplierId: supplier.id,
        invoiceNumber: 'REC-B1',
        items: [
          {
            productId: Number(testProductId),
            quantity: 40,
            conversionFactor: 1,
            unitCostPrice: 50000,
            sellingPrice: 65000,
            lineTotal: 2000000
          }
        ],
        additionalCost: 0,
        amountPaid: 0
      });

      // 2. Disburse Payment (-12,000)
      supplierService.recordSupplierPayment(
        {
          supplierId: supplier.id,
          amountMinor: 1200000,
          paymentMethod: 'CASH'
        },
        actor
      );

      // 3. Supplier Return (-3,000)
      supplierService.recordSupplierReturn(
        {
          supplierId: supplier.id,
          amountMinor: 300000,
          reason: 'Expired oil cans returned'
        },
        actor
      );

      // 4. Authorized Debit Adjustment (-1,000)
      supplierService.recordAdjustment(
        {
          supplierId: supplier.id,
          adjustmentType: 'DEBIT',
          amountMinor: 100000,
          reason: 'Agreed volume rebate discount'
        },
        actor
      );

      // Expected calculation:
      // Opening:     +10,000 (1,000,000)
      // Purchase:    +20,000 (2,000,000) -> 3,000,000
      // Payment:     -12,000 (1,200,000) -> 1,800,000
      // Return:       -3,000   (300,000) -> 1,500,000
      // Adjustment:   -1,000   (100,000) -> 1,400,000 (Rs. 14,000)
      const statement = supplierService.getSupplierStatement(supplier.id);

      expect(statement.openingBalanceMinor).toBe(0); // From beginning of time
      expect(statement.totalPurchasesMinor).toBe(2000000);
      expect(statement.totalPaymentsMinor).toBe(1200000);
      expect(statement.totalReturnsMinor).toBe(300000);
      expect(statement.closingBalanceMinor).toBe(1400000);

      // Running balances must match step-by-step
      expect(statement.entries[0].runningBalanceMinor).toBe(1000000); // Opening
      expect(statement.entries[1].runningBalanceMinor).toBe(3000000); // Purchase
      expect(statement.entries[2].runningBalanceMinor).toBe(1800000); // Payment
      expect(statement.entries[3].runningBalanceMinor).toBe(1500000); // Return
      expect(statement.entries[4].runningBalanceMinor).toBe(1400000); // Adjustment

      // Reconcile cached balance against ledger sum
      const recon = supplierService.reconcileSupplierBalance(supplier.id);
      expect(recon.isReconciled).toBe(true);
      expect(recon.discrepancy).toBe(0);
      expect(recon.ledgerBalance).toBe(1400000);
    });
  });
});
