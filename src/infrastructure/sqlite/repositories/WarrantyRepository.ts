import Database from 'better-sqlite3';
import { getDatabase } from '../connection';
import { WarrantyCase, WarrantyMovement } from '../../../shared/types';

export class WarrantyRepository {
  constructor(private db: Database.Database = getDatabase()) {}

  public createCase(wCase: {
    caseNumber: string;
    productId: number;
    variantId?: number;
    serialId?: number;
    supplierId?: number;
    companyId?: number;
    customerId?: number;
    issueDescription: string;
  }): number {
    const info = this.db.prepare(`
      INSERT INTO warranty_cases (
        case_number, product_id, variant_id, serial_id, supplier_id,
        company_id, customer_id, issue_description, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED')
    `).run(
      wCase.caseNumber,
      wCase.productId,
      wCase.variantId || null,
      wCase.serialId || null,
      wCase.supplierId || null,
      wCase.companyId || null,
      wCase.customerId || null,
      wCase.issueDescription
    );

    const caseId = Number(info.lastInsertRowid);

    // Initial movement intake
    this.addMovement({
      warrantyCaseId: caseId,
      movementType: 'INTAKE',
      quantityScaled: 1,
      serialId: wCase.serialId,
      notes: 'Initial customer intake for warranty service'
    });

    return caseId;
  }

  public addMovement(movement: {
    warrantyCaseId: number;
    movementType: 'INTAKE' | 'DISPATCH' | 'REPAIR_RECEIPT' | 'CUSTOMER_DELIVERY' | 'SCRAPPED';
    quantityScaled?: number;
    serialId?: number;
    sourceDocumentId?: number;
    notes?: string;
  }): number {
    const info = this.db.prepare(`
      INSERT INTO warranty_movements (
        warranty_case_id, movement_type, quantity_scaled, serial_id, source_document_id, notes
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      movement.warrantyCaseId,
      movement.movementType,
      movement.quantityScaled || 1,
      movement.serialId || null,
      movement.sourceDocumentId || null,
      movement.notes || null
    );

    // Update warranty case status based on movement type
    let newStatus = 'RECEIVED';
    if (movement.movementType === 'DISPATCH') newStatus = 'DISPATCHED_TO_COMPANY';
    if (movement.movementType === 'REPAIR_RECEIPT') newStatus = 'RETURNED_FROM_COMPANY';
    if (movement.movementType === 'CUSTOMER_DELIVERY') newStatus = 'DELIVERED_TO_CUSTOMER';

    this.db.prepare(`
      UPDATE warranty_cases SET status = ? WHERE id = ?
    `).run(newStatus, movement.warrantyCaseId);

    return Number(info.lastInsertRowid);
  }

  public getCaseById(id: number): WarrantyCase | null {
    const row = this.db.prepare(`
      SELECT w.id, w.case_number as caseNumber, w.product_id as productId, p.name as productName,
             w.variant_id as variantId, w.serial_id as serialId, s.serial_number as serialNumber,
             w.supplier_id as supplierId, w.company_id as companyId,
             w.customer_id as customerId, c.name as customerName,
             w.issue_description as issueDescription, w.status, w.created_at as createdAt
      FROM warranty_cases w
      LEFT JOIN products p ON w.product_id = p.id
      LEFT JOIN product_serial_numbers s ON w.serial_id = s.id
      LEFT JOIN customers c ON w.customer_id = c.id
      WHERE w.id = ?
    `).get(id) as any;

    return row || null;
  }

  public listCases(): WarrantyCase[] {
    const rows = this.db.prepare(`
      SELECT w.id, w.case_number as caseNumber, w.product_id as productId, p.name as productName,
             w.variant_id as variantId, w.serial_id as serialId, s.serial_number as serialNumber,
             w.supplier_id as supplierId, w.company_id as companyId,
             w.customer_id as customerId, c.name as customerName,
             w.issue_description as issueDescription, w.status, w.created_at as createdAt
      FROM warranty_cases w
      LEFT JOIN products p ON w.product_id = p.id
      LEFT JOIN product_serial_numbers s ON w.serial_id = s.id
      LEFT JOIN customers c ON w.customer_id = c.id
      ORDER BY w.id DESC
      LIMIT 100
    `).all() as any[];

    return rows;
  }
}

