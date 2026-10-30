import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { getDatabase } from '../connection';
import {
  StockTransfer,
  StockTransferLine,
  StockTransferReceipt,
  StockTransferReceiptLine,
  CreateStockTransferInput,
  ReceiveStockTransferInput,
  StockTransferFilter,
  StockTransferStatus
} from '../../../shared/types/stock-transfer';
import { StockTransferRules } from '../../../domain/inventory/stock-transfer-rules';

export class StockTransferRepository {
  constructor(private db: Database.Database = getDatabase()) {}

  public getDb(): Database.Database {
    return this.db;
  }

  /**
   * Generates sequential transfer document number: TRF-YYYY-XXXXX
   */
  public generateTransferNumber(businessId: string): string {
    const year = new Date().getFullYear();
    const prefix = `TRF-${year}-`;

    const row = this.db
      .prepare(
        `SELECT transfer_number FROM stock_transfers
         WHERE business_id = ? AND transfer_number LIKE ?
         ORDER BY transfer_number DESC LIMIT 1`
      )
      .get(businessId, `${prefix}%`) as { transfer_number: string } | undefined;

    let nextSeq = 1;
    if (row && row.transfer_number) {
      const parts = row.transfer_number.split('-');
      if (parts.length >= 3) {
        const parsed = parseInt(parts[2], 10);
        if (!isNaN(parsed)) {
          nextSeq = parsed + 1;
        }
      }
    }

    return `${prefix}${String(nextSeq).padStart(5, '0')}`;
  }

  /**
   * Generates sequential receipt document number: RCP-YYYY-XXXXX
   */
  public generateReceiptNumber(businessId: string): string {
    const year = new Date().getFullYear();
    const prefix = `RCP-${year}-`;

    const row = this.db
      .prepare(
        `SELECT receipt_number FROM stock_transfer_receipts
         WHERE receipt_number LIKE ?
         ORDER BY receipt_number DESC LIMIT 1`
      )
      .get(`${prefix}%`) as { receipt_number: string } | undefined;

    let nextSeq = 1;
    if (row && row.receipt_number) {
      const parts = row.receipt_number.split('-');
      if (parts.length >= 3) {
        const parsed = parseInt(parts[2], 10);
        if (!isNaN(parsed)) {
          nextSeq = parsed + 1;
        }
      }
    }

    return `${prefix}${String(nextSeq).padStart(5, '0')}`;
  }

  /**
   * Finds or creates a designated in-transit stock location for a branch route.
   */
  public getOrCreateInTransitLocation(businessId: string, branchId: string): string {
    const code = `IN-TRANSIT-${branchId.slice(0, 8)}`;
    const row = this.db
      .prepare(`SELECT id FROM stock_locations WHERE branch_id = ? AND (code = ? OR location_type = 'other' AND is_sellable = 0) LIMIT 1`)
      .get(branchId, code) as { id: string } | undefined;

    if (row) return row.id;

    const locId = randomUUID();
    this.db
      .prepare(
        `INSERT INTO stock_locations (
          id, business_id, branch_id, name, code, location_type,
          is_default, is_sellable, is_receivable, is_active
        ) VALUES (?, ?, ?, 'In-Transit Storage', ?, 'other', 0, 0, 1, 1)`
      )
      .run(locId, businessId, branchId, code);

    return locId;
  }

  /**
   * Creates a draft or requested stock transfer.
   */
  public createTransfer(
    input: CreateStockTransferInput,
    actorId: string,
    inTransitLocationId: string
  ): StockTransfer {
    const businessId = input.businessId || '00000000-0000-0000-0000-000000000001';
    const transferId = randomUUID();
    const transferNumber = this.generateTransferNumber(businessId);
    const initialStatus = input.autoSubmit ? 'requested' : 'draft';
    const now = new Date().toISOString();
    const idempotencyKey = input.idempotencyKey || `TRF-${transferId}`;

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO stock_transfers (
            id, business_id, transfer_number, transfer_type,
            source_branch_id, destination_branch_id,
            source_location_id, destination_location_id, in_transit_location_id,
            status, requested_by, requested_at, notes, idempotency_key,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          transferId,
          businessId,
          transferNumber,
          input.transferType || 'internal',
          input.sourceBranchId,
          input.destinationBranchId,
          input.sourceLocationId,
          input.destinationLocationId,
          inTransitLocationId,
          initialStatus,
          actorId,
          input.autoSubmit ? now : null,
          input.notes || null,
          idempotencyKey,
          now,
          now
        );

      const insertLine = this.db.prepare(`
        INSERT INTO stock_transfer_lines (
          id, transfer_id, product_id, variant_id, batch_id, serial_number_id,
          requested_quantity_scaled, dispatched_quantity_scaled,
          received_quantity_scaled, rejected_quantity_scaled, loss_quantity_scaled,
          unit_id, unit_cost_minor, quantity_scaled, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?, ?, ?, ?)
      `);

      for (const line of input.lines) {
        const lineId = randomUUID();
        let unitId = line.unitId || null;
        if (!unitId) {
          const prodRow = this.db.prepare('SELECT base_unit_id FROM products WHERE id = ?').get(line.productId) as { base_unit_id?: string } | undefined;
          unitId = prodRow?.base_unit_id || null;
        }

        insertLine.run(
          lineId,
          transferId,
          String(line.productId),
          line.variantId ? String(line.variantId) : null,
          line.batchId ? String(line.batchId) : null,
          line.serialNumberId ? String(line.serialNumberId) : null,
          line.requestedQuantityScaled,
          unitId,
          line.unitCostMinor || 0,
          line.requestedQuantityScaled, // legacy compatibility
          line.notes || null,
          now,
          now
        );
      }
    });

    tx();

    return this.getTransferById(transferId)!;
  }

  /**
   * Retrieves single stock transfer with all details.
   */
  public getTransferById(id: string): StockTransfer | null {
    const row = this.db
      .prepare(
        `SELECT t.*,
                src_l.name as source_location_name,
                dest_l.name as destination_location_name,
                trans_l.name as in_transit_location_name,
                u_req.full_name as requester_name,
                u_app.full_name as approver_name,
                u_disp.full_name as dispatcher_name,
                u_rec.full_name as receiver_name
         FROM stock_transfers t
         LEFT JOIN stock_locations src_l ON t.source_location_id = src_l.id
         LEFT JOIN stock_locations dest_l ON t.destination_location_id = dest_l.id
         LEFT JOIN stock_locations trans_l ON t.in_transit_location_id = trans_l.id
         LEFT JOIN users u_req ON t.requested_by = u_req.id
         LEFT JOIN users u_app ON t.approved_by = u_app.id
         LEFT JOIN users u_disp ON t.dispatched_by = u_disp.id
         LEFT JOIN users u_rec ON t.received_by = u_rec.id
         WHERE t.id = ?`
      )
      .get(id) as any;

    if (!row) return null;

    const rawLines = this.db
      .prepare(
        `SELECT l.*, p.name as product_name, p.sku as product_sku, u.name as unit_name
         FROM stock_transfer_lines l
         JOIN products p ON l.product_id = p.id
         LEFT JOIN units u ON l.unit_id = u.id
         WHERE l.transfer_id = ?
         ORDER BY l.rowid ASC`
      )
      .all(id) as any[];

    const lines: StockTransferLine[] = rawLines.map((l) => ({
      id: l.id,
      transferId: l.transfer_id,
      productId: l.product_id,
      productName: l.product_name,
      productSku: l.product_sku,
      variantId: l.variant_id,
      batchId: l.batch_id,
      serialNumberId: l.serial_number_id,
      requestedQuantityScaled: l.requested_quantity_scaled ?? l.quantity_scaled,
      dispatchedQuantityScaled: l.dispatched_quantity_scaled || 0,
      receivedQuantityScaled: l.received_quantity_scaled || 0,
      rejectedQuantityScaled: l.rejected_quantity_scaled || 0,
      lossQuantityScaled: l.loss_quantity_scaled || 0,
      unitId: l.unit_id,
      unitName: l.unit_name,
      unitCostMinor: l.unit_cost_minor,
      quantityScaled: l.quantity_scaled,
      notes: l.notes
    }));

    const receipts = this.getReceiptsByTransferId(id);

    return {
      id: row.id,
      businessId: row.business_id,
      transferNumber: row.transfer_number,
      transferType: row.transfer_type,
      sourceBranchId: row.source_branch_id,
      sourceLocationId: row.source_location_id,
      sourceLocationName: row.source_location_name,
      destinationBranchId: row.destination_branch_id,
      destinationLocationId: row.destination_location_id,
      destinationLocationName: row.destination_location_name,
      inTransitLocationId: row.in_transit_location_id,
      inTransitLocationName: row.in_transit_location_name,
      status: row.status,
      requestedBy: row.requested_by,
      requesterName: row.requester_name,
      approvedBy: row.approved_by,
      approverName: row.approver_name,
      dispatchedBy: row.dispatched_by,
      dispatcherName: row.dispatcher_name,
      receivedBy: row.received_by,
      receiverName: row.receiver_name,
      requestedAt: row.requested_at,
      approvedAt: row.approved_at,
      dispatchedAt: row.dispatched_at,
      receivedAt: row.received_at,
      notes: row.notes,
      idempotencyKey: row.idempotency_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lines,
      receipts
    };
  }

  /**
   * Retrieves all receipt history records for a transfer.
   */
  public getReceiptsByTransferId(transferId: string): StockTransferReceipt[] {
    const receipts = this.db
      .prepare(
        `SELECT r.*, u.full_name as receiver_name
         FROM stock_transfer_receipts r
         LEFT JOIN users u ON r.received_by = u.id
         WHERE r.transfer_id = ?
         ORDER BY r.received_at ASC`
      )
      .all(transferId) as any[];

    return receipts.map((r) => {
      const lines = this.db
        .prepare(
          `SELECT rl.*, p.name as product_name, loc.name as rejected_location_name
           FROM stock_transfer_receipt_lines rl
           JOIN products p ON rl.product_id = p.id
           LEFT JOIN stock_locations loc ON rl.rejected_location_id = loc.id
           WHERE rl.receipt_id = ?`
        )
        .all(r.id) as any[];

      return {
        id: r.id,
        transferId: r.transfer_id,
        receiptNumber: r.receipt_number,
        receivedBy: r.received_by,
        receiverName: r.receiver_name,
        receivedAt: r.received_at,
        notes: r.notes,
        lines: lines.map((l) => ({
          id: l.id,
          receiptId: l.receipt_id,
          transferLineId: l.transfer_line_id,
          productId: l.product_id,
          productName: l.product_name,
          receivedQuantityScaled: l.received_quantity_scaled,
          rejectedQuantityScaled: l.rejected_quantity_scaled,
          lossQuantityScaled: l.loss_quantity_scaled,
          rejectedLocationId: l.rejected_location_id,
          rejectedLocationName: l.rejected_location_name,
          discrepancyReason: l.discrepancy_reason,
          discrepancyAction: l.discrepancy_action,
          notes: l.notes
        }))
      };
    });
  }

  /**
   * Lists transfers matching filters.
   */
  public listTransfers(filter: StockTransferFilter): StockTransfer[] {
    let sql = `
      SELECT t.*,
             src_l.name as source_location_name,
             dest_l.name as destination_location_name,
             u_req.full_name as requester_name
      FROM stock_transfers t
      LEFT JOIN stock_locations src_l ON t.source_location_id = src_l.id
      LEFT JOIN stock_locations dest_l ON t.destination_location_id = dest_l.id
      LEFT JOIN users u_req ON t.requested_by = u_req.id
      WHERE t.business_id = ?
    `;
    const params: any[] = [filter.businessId];

    if (filter.branchId) {
      sql += ` AND (t.source_branch_id = ? OR t.destination_branch_id = ?)`;
      params.push(filter.branchId, filter.branchId);
    }
    if (filter.sourceLocationId) {
      sql += ` AND t.source_location_id = ?`;
      params.push(filter.sourceLocationId);
    }
    if (filter.destinationLocationId) {
      sql += ` AND t.destination_location_id = ?`;
      params.push(filter.destinationLocationId);
    }
    if (filter.status) {
      sql += ` AND t.status = ?`;
      params.push(filter.status);
    }
    if (filter.transferType) {
      sql += ` AND t.transfer_type = ?`;
      params.push(filter.transferType);
    }

    sql += ` ORDER BY t.created_at DESC`;

    const rows = this.db.prepare(sql).all(...params) as any[];

    return rows.map((r) => ({
      id: r.id,
      businessId: r.business_id,
      transferNumber: r.transfer_number,
      transferType: r.transfer_type,
      sourceBranchId: r.source_branch_id,
      sourceLocationId: r.source_location_id,
      sourceLocationName: r.source_location_name,
      destinationBranchId: r.destination_branch_id,
      destinationLocationId: r.destination_location_id,
      destinationLocationName: r.destination_location_name,
      inTransitLocationId: r.in_transit_location_id,
      status: r.status,
      requestedBy: r.requested_by,
      requesterName: r.requester_name,
      approvedBy: r.approved_by,
      dispatchedBy: r.dispatched_by,
      receivedBy: r.received_by,
      requestedAt: r.requested_at,
      approvedAt: r.approved_at,
      dispatchedAt: r.dispatched_at,
      receivedAt: r.received_at,
      notes: r.notes,
      idempotencyKey: r.idempotency_key,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }

  /**
   * Updates transfer status.
   */
  public updateStatus(id: string, status: StockTransferStatus): void {
    this.db
      .prepare(`UPDATE stock_transfers SET status = ?, updated_at = (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')) WHERE id = ?`)
      .run(status, id);
  }
}
