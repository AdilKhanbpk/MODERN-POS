import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { getDatabase } from '../../infrastructure/sqlite/connection';
import {
  StockTransfer,
  StockTransferLine,
  StockTransferReceipt,
  CreateStockTransferInput,
  DispatchStockTransferInput,
  ReceiveStockTransferInput,
  StockTransferFilter,
  TransferActorContext,
  StockTransferStatus,
  StockTransferType
} from '../../shared/types/stock-transfer';
import {
  StockTransferRules,
  InsufficientSourceStockError,
  CrossBranchTransferDisabledError,
  CrossBranchMismatchError,
  TransferOverReceiptError,
  InvalidTransferStateError,
  TransferImmutabilityError
} from '../../domain/inventory/stock-transfer-rules';
import { StockTransferRepository } from '../../infrastructure/sqlite/repositories/StockTransferRepository';
import { StockBalanceRepository } from '../../infrastructure/sqlite/repositories/StockBalanceRepository';
import { StockLocationRepository } from '../../infrastructure/sqlite/repositories/StockLocationRepository';
import { ModuleManager } from '../modules/ModuleManager';

export {
  InsufficientSourceStockError,
  CrossBranchTransferDisabledError,
  CrossBranchMismatchError,
  TransferOverReceiptError,
  InvalidTransferStateError,
  TransferImmutabilityError
};

export class StockTransferService {
  private transferRepo: StockTransferRepository;
  private balanceRepo: StockBalanceRepository;
  private locationRepo: StockLocationRepository;

  constructor(
    private db: Database.Database = getDatabase(),
    private moduleManager?: ModuleManager
  ) {
    this.transferRepo = new StockTransferRepository(this.db);
    this.balanceRepo = new StockBalanceRepository(this.db);
    this.locationRepo = new StockLocationRepository(this.db);
  }

  public getDb(): Database.Database {
    return this.db;
  }

  /**
   * Helper: checks if multi-branch module is active for the business
   */
  public isMultiBranchEnabled(businessId: string): boolean {
    if (this.moduleManager) {
      return this.moduleManager.isModuleEnabled(businessId, 'multi_branch');
    }
    const row = this.db
      .prepare(`
        SELECT bm.is_enabled
        FROM business_modules bm
        JOIN module_definitions md ON md.id = bm.module_id
        WHERE bm.business_id = ? AND md.module_code = 'multi_branch'
      `)
      .get(businessId) as { is_enabled: number } | undefined;
    return row ? row.is_enabled === 1 : false;
  }

  /**
   * Creates a stock transfer in 'draft' or 'requested' status.
   */
  public createTransfer(
    input: CreateStockTransferInput,
    actor: TransferActorContext
  ): StockTransfer {
    if (!input.lines || input.lines.length === 0) {
      throw new Error('Stock transfer must contain at least one product line.');
    }

    const businessId = input.businessId || actor.businessId;

    // Fetch locations
    const sourceLoc = this.locationRepo.findById(input.sourceLocationId, businessId);
    if (!sourceLoc) {
      throw new Error(`Source stock location "${input.sourceLocationId}" not found.`);
    }

    const destLoc = this.locationRepo.findById(input.destinationLocationId, businessId);
    if (!destLoc) {
      throw new Error(`Destination stock location "${input.destinationLocationId}" not found.`);
    }

    const isMultiBranchActive = this.isMultiBranchEnabled(businessId);

    // Validate location rules & determine transfer type
    const determinedType = StockTransferRules.validateTransferLocations({
      sourceLocation: sourceLoc,
      destinationLocation: destLoc,
      isMultiBranchEnabled: isMultiBranchActive,
      declaredTransferType: input.transferType
    });

    // Validate requested quantity and source stock availability
    for (const line of input.lines) {
      if (line.requestedQuantityScaled <= 0) {
        throw new Error('Transfer line quantity must be strictly greater than zero.');
      }

      const balance = this.balanceRepo.getBalance(
        line.productId,
        sourceLoc.id,
        businessId,
        line.variantId
      );

      const available = balance ? balance.availableScaled : 0;
      const productRow = this.db
        .prepare('SELECT name, cost_price FROM products WHERE id = ?')
        .get(line.productId) as { name: string; cost_price: number } | undefined;

      const prodName = productRow ? productRow.name : `Product #${line.productId}`;
      StockTransferRules.validateStockAvailability(available, line.requestedQuantityScaled, prodName);

      // Populate unit cost if not provided
      if (line.unitCostMinor === undefined || line.unitCostMinor === null) {
        line.unitCostMinor = productRow && productRow.cost_price != null ? Math.round(productRow.cost_price) : 0;
      }
    }

    const inTransitLocationId = this.transferRepo.getOrCreateInTransitLocation(
      businessId,
      destLoc.branchId
    );

    return this.transferRepo.createTransfer(
      {
        ...input,
        businessId,
        sourceBranchId: sourceLoc.branchId,
        destinationBranchId: destLoc.branchId,
        transferType: determinedType
      },
      String(actor.userId),
      inTransitLocationId
    );
  }

  /**
   * Approves a requested stock transfer.
   */
  public approveTransfer(id: string, actor: TransferActorContext): StockTransfer {
    const transfer = this.transferRepo.getTransferById(id);
    if (!transfer) {
      throw new Error(`Stock transfer "${id}" not found.`);
    }

    const role = (actor.role || '').toLowerCase();
    if (role === 'cashier') {
      throw new Error('Cashiers are not permitted to approve stock transfers.');
    }

    StockTransferRules.validateStatusTransition(transfer.status, 'approved');

    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE stock_transfers
        SET status = 'approved',
            approved_by = ?,
            approved_at = ?,
            updated_at = ?
        WHERE id = ?
      `)
      .run(String(actor.userId), now, now, id);

    return this.transferRepo.getTransferById(id)!;
  }

  /**
   * Dispatches a transfer:
   * Moves stock from source location to in-transit location atomically.
   * Records movement ledger entries for dispatch out and transit in.
   */
  public dispatchTransfer(
    input: DispatchStockTransferInput,
    actor: TransferActorContext
  ): StockTransfer {
    const transfer = this.transferRepo.getTransferById(input.transferId);
    if (!transfer) {
      throw new Error(`Stock transfer "${input.transferId}" not found.`);
    }

    // Must be in 'approved' or 'requested' state
    StockTransferRules.validateStatusTransition(transfer.status, 'dispatched');

    const now = new Date().toISOString();
    const inTransitLocationId = transfer.inTransitLocationId;
    if (!inTransitLocationId) {
      throw new Error(`Transfer ${transfer.transferNumber} does not have an assigned in-transit location.`);
    }

    const transferLines = transfer.lines || [];

    const tx = this.db.transaction(() => {
      for (const line of transferLines) {
        // Determine dispatch quantity
        let dispatchQty = line.requestedQuantityScaled;
        if (input.dispatchedLines) {
          const override = input.dispatchedLines.find((l) => l.lineId === line.id);
          if (override && override.dispatchedQuantityScaled !== undefined && override.dispatchedQuantityScaled > 0) {
            dispatchQty = override.dispatchedQuantityScaled;
          }
        }

        // Validate stock availability at dispatch time
        const balance = this.balanceRepo.getBalance(
          line.productId,
          transfer.sourceLocationId,
          transfer.businessId,
          line.variantId
        );
        const available = balance ? balance.availableScaled : 0;
        StockTransferRules.validateStockAvailability(available, dispatchQty, line.productName || 'Product');

        // 1. Decrement source location stock
        this.balanceRepo.upsertDelta({
          businessId: transfer.businessId,
          productId: line.productId,
          variantId: line.variantId,
          stockLocationId: transfer.sourceLocationId,
          onHandDeltaScaled: -dispatchQty
        });

        // 2. Increment in-transit location stock
        this.balanceRepo.upsertDelta({
          businessId: transfer.businessId,
          productId: line.productId,
          variantId: line.variantId,
          stockLocationId: inTransitLocationId,
          onHandDeltaScaled: dispatchQty
        });

        // 3. Record source dispatch movement (OUT)
        const sourceMovementId = randomUUID();
        const sourceIdempotency = `TRF-DISP-SRC-${transfer.id}-${line.id}`;
        this.db.prepare(`
          INSERT INTO stock_movements (
            id, business_id, branch_id, product_id, variant_id, stock_location_id,
            movement_type, direction, quantity_scaled, base_unit_id, unit_precision,
            unit_cost_minor, total_cost_minor, reference_type, reference_id,
            reference_line_id, idempotency_key, occurred_at, posted_at, created_by,
            created_at, location_id, quantity, previous_stock, new_stock, quantity_base_scaled,
            reason, user_id
          ) VALUES (
            ?, ?, ?, ?, ?, ?,
            'TRANSFER_DISPATCH', 'OUT', ?, ?, 3,
            ?, ?, 'STOCK_TRANSFER', ?,
            ?, ?, ?, ?, ?,
            ?, 1, ?, ?, ?, ?,
            ?, ?
          )
        `).run(
          sourceMovementId,
          transfer.businessId,
          transfer.sourceBranchId,
          line.productId,
          line.variantId || null,
          transfer.sourceLocationId,
          dispatchQty,
          line.unitId || null,
          line.unitCostMinor || null,
          line.unitCostMinor != null ? Math.round((line.unitCostMinor * dispatchQty) / 1000) : null,
          transfer.id,
          line.id,
          sourceIdempotency,
          now,
          now,
          String(actor.userId),
          now,
          dispatchQty / 1000,
          available / 1000,
          (available - dispatchQty) / 1000,
          dispatchQty,
          `Stock transfer dispatch to ${transfer.destinationLocationName || 'destination'}`,
          Number(actor.userId) || 1
        );

        // 4. Record transit dispatch movement (IN)
        const transitMovementId = randomUUID();
        const transitIdempotency = `TRF-DISP-TRN-${transfer.id}-${line.id}`;
        this.db.prepare(`
          INSERT INTO stock_movements (
            id, business_id, branch_id, product_id, variant_id, stock_location_id,
            movement_type, direction, quantity_scaled, base_unit_id, unit_precision,
            unit_cost_minor, total_cost_minor, reference_type, reference_id,
            reference_line_id, idempotency_key, occurred_at, posted_at, created_by,
            created_at, location_id, quantity, previous_stock, new_stock, quantity_base_scaled,
            reason, user_id
          ) VALUES (
            ?, ?, ?, ?, ?, ?,
            'TRANSFER_DISPATCH', 'IN', ?, ?, 3,
            ?, ?, 'STOCK_TRANSFER', ?,
            ?, ?, ?, ?, ?,
            ?, 1, ?, ?, ?, ?,
            ?, ?
          )
        `).run(
          transitMovementId,
          transfer.businessId,
          transfer.destinationBranchId,
          line.productId,
          line.variantId || null,
          inTransitLocationId,
          dispatchQty,
          line.unitId || null,
          line.unitCostMinor || null,
          line.unitCostMinor != null ? Math.round((line.unitCostMinor * dispatchQty) / 1000) : null,
          transfer.id,
          line.id,
          transitIdempotency,
          now,
          now,
          String(actor.userId),
          now,
          dispatchQty / 1000,
          0,
          dispatchQty / 1000,
          dispatchQty,
          `Stock in-transit from ${transfer.sourceLocationName || 'source'}`,
          Number(actor.userId) || 1
        );

        // 5. Update transfer line with dispatched quantity
        this.db.prepare(`
          UPDATE stock_transfer_lines
          SET dispatched_quantity_scaled = ?
          WHERE id = ?
        `).run(dispatchQty, line.id);
      }

      // Update transfer status
      this.db.prepare(`
        UPDATE stock_transfers
        SET status = 'dispatched',
            dispatched_by = ?,
            dispatched_at = ?,
            notes = COALESCE(?, notes),
            updated_at = ?
        WHERE id = ?
      `).run(
        String(actor.userId),
        now,
        input.notes || null,
        now,
        transfer.id
      );
    });

    tx();
    return this.transferRepo.getTransferById(transfer.id)!;
  }

  /**
   * Receives a transfer (full or partial receipt):
   * Moves accepted stock from in-transit to destination location.
   * Routes rejected stock to quarantine/damaged location.
   * Writes off missing items with TRANSFER_LOSS movement.
   */
  public receiveTransfer(
    input: ReceiveStockTransferInput,
    actor: TransferActorContext
  ): StockTransfer {
    const transfer = this.transferRepo.getTransferById(input.transferId);
    if (!transfer) {
      throw new Error(`Stock transfer "${input.transferId}" not found.`);
    }

    if (transfer.status === 'received') {
      throw new TransferImmutabilityError(
        'Stock transfer has already been completed and received. It is strictly immutable and cannot be altered.'
      );
    }

    if (transfer.status !== 'dispatched' && transfer.status !== 'partially_received') {
      throw new InvalidTransferStateError(
        `Cannot receive transfer in "${transfer.status}" status. Transfer must be "dispatched" or "partially_received".`
      );
    }

    const inTransitLocationId = transfer.inTransitLocationId;
    if (!inTransitLocationId) {
      throw new Error(`In-transit location is missing for transfer ${transfer.transferNumber}.`);
    }

    const now = new Date().toISOString();
    const receiptId = randomUUID();
    const receiptNumber = this.transferRepo.generateReceiptNumber(transfer.businessId);
    const transferLines = transfer.lines || [];

    const tx = this.db.transaction(() => {
      // 1. Create receipt record
      this.db.prepare(`
        INSERT INTO stock_transfer_receipts (
          id, transfer_id, receipt_number, received_by, received_at, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        receiptId,
        transfer.id,
        receiptNumber,
        String(actor.userId),
        now,
        input.notes || null,
        now
      );

      for (const lineInput of input.lines) {
        const transferLine = transferLines.find((l) => l.id === lineInput.lineId);
        if (!transferLine) {
          throw new Error(`Transfer line "${lineInput.lineId}" not found.`);
        }

        const receivedScaled = lineInput.receivedQuantityScaled || 0;
        const rejectedScaled = lineInput.rejectedQuantityScaled || 0;
        const lossScaled = lineInput.lossQuantityScaled || 0;
        const currentBatch = receivedScaled + rejectedScaled + lossScaled;

        if (currentBatch <= 0) {
          continue;
        }

        // Validate over-receipt
        StockTransferRules.evaluateReceiptQuantities({
          dispatchedScaled: transferLine.dispatchedQuantityScaled,
          receivedScaled,
          rejectedScaled,
          lossScaled,
          previousReceivedScaled: transferLine.receivedQuantityScaled,
          previousRejectedScaled: transferLine.rejectedQuantityScaled,
          previousLossScaled: transferLine.lossQuantityScaled
        });

        // 2. Decrement in-transit stock for total accounted
        this.balanceRepo.upsertDelta({
          businessId: transfer.businessId,
          productId: transferLine.productId,
          variantId: transferLine.variantId,
          stockLocationId: inTransitLocationId,
          onHandDeltaScaled: -currentBatch
        });

        // 3. Increment destination location stock for accepted items
        if (receivedScaled > 0) {
          this.balanceRepo.upsertDelta({
            businessId: transfer.businessId,
            productId: transferLine.productId,
            variantId: transferLine.variantId,
            stockLocationId: transfer.destinationLocationId,
            onHandDeltaScaled: receivedScaled
          });

          // Record receipt movement (IN)
          const rcvMovementId = randomUUID();
          const rcvIdempotency = `TRF-RCV-${receiptId}-${transferLine.id}`;
          this.db.prepare(`
            INSERT INTO stock_movements (
              id, business_id, branch_id, product_id, variant_id, stock_location_id,
              movement_type, direction, quantity_scaled, base_unit_id, unit_precision,
              unit_cost_minor, total_cost_minor, reference_type, reference_id,
              reference_line_id, idempotency_key, occurred_at, posted_at, created_by,
              created_at, location_id, quantity, previous_stock, new_stock, quantity_base_scaled,
              reason, user_id
            ) VALUES (
              ?, ?, ?, ?, ?, ?,
              'TRANSFER_RECEIPT', 'IN', ?, ?, 3,
              ?, ?, 'STOCK_TRANSFER', ?,
              ?, ?, ?, ?, ?,
              ?, 1, ?, 0, ?, ?,
              ?, ?
            )
          `).run(
            rcvMovementId,
            transfer.businessId,
            transfer.destinationBranchId,
            transferLine.productId,
            transferLine.variantId || null,
            transfer.destinationLocationId,
            receivedScaled,
            transferLine.unitId || null,
            transferLine.unitCostMinor || null,
            transferLine.unitCostMinor != null ? Math.round((transferLine.unitCostMinor * receivedScaled) / 1000) : null,
            transfer.id,
            transferLine.id,
            rcvIdempotency,
            now,
            now,
            String(actor.userId),
            now,
            receivedScaled / 1000,
            receivedScaled / 1000,
            receivedScaled,
            `Stock transfer receipt into ${transfer.destinationLocationName || 'destination'}`,
            Number(actor.userId) || 1
          );
        }

        // 4. Handle rejected items (route to quarantine / damaged location)
        if (rejectedScaled > 0) {
          const rejectedLocId = lineInput.rejectedLocationId || transfer.destinationLocationId;
          this.balanceRepo.upsertDelta({
            businessId: transfer.businessId,
            productId: transferLine.productId,
            variantId: transferLine.variantId,
            stockLocationId: rejectedLocId,
            onHandDeltaScaled: rejectedScaled
          });

          const rejMovementId = randomUUID();
          const rejIdempotency = `TRF-REJ-${receiptId}-${transferLine.id}`;
          this.db.prepare(`
            INSERT INTO stock_movements (
              id, business_id, branch_id, product_id, variant_id, stock_location_id,
              movement_type, direction, quantity_scaled, base_unit_id, unit_precision,
              unit_cost_minor, total_cost_minor, reference_type, reference_id,
              reference_line_id, idempotency_key, occurred_at, posted_at, created_by,
              created_at, location_id, quantity, previous_stock, new_stock, quantity_base_scaled,
              reason, user_id
            ) VALUES (
              ?, ?, ?, ?, ?, ?,
              'TRANSFER_REJECTED', 'IN', ?, ?, 3,
              ?, ?, 'STOCK_TRANSFER', ?,
              ?, ?, ?, ?, ?,
              ?, 1, ?, 0, ?, ?,
              ?, ?
            )
          `).run(
            rejMovementId,
            transfer.businessId,
            transfer.destinationBranchId,
            transferLine.productId,
            transferLine.variantId || null,
            rejectedLocId,
            rejectedScaled,
            transferLine.unitId || null,
            transferLine.unitCostMinor || null,
            transferLine.unitCostMinor != null ? Math.round((transferLine.unitCostMinor * rejectedScaled) / 1000) : null,
            transfer.id,
            transferLine.id,
            rejIdempotency,
            now,
            now,
            String(actor.userId),
            now,
            rejectedScaled / 1000,
            rejectedScaled / 1000,
            rejectedScaled,
            `Transfer rejected items: ${lineInput.discrepancyReason || 'Damaged in transit'}`,
            Number(actor.userId) || 1
          );
        }

        // 5. Handle loss items (discrepancy write-off from in-transit)
        if (lossScaled > 0) {
          const lossMovementId = randomUUID();
          const lossIdempotency = `TRF-LOSS-${receiptId}-${transferLine.id}`;
          this.db.prepare(`
            INSERT INTO stock_movements (
              id, business_id, branch_id, product_id, variant_id, stock_location_id,
              movement_type, direction, quantity_scaled, base_unit_id, unit_precision,
              unit_cost_minor, total_cost_minor, reference_type, reference_id,
              reference_line_id, idempotency_key, occurred_at, posted_at, created_by,
              created_at, location_id, quantity, previous_stock, new_stock, quantity_base_scaled,
              reason, user_id
            ) VALUES (
              ?, ?, ?, ?, ?, ?,
              'TRANSFER_LOSS', 'OUT', ?, ?, 3,
              ?, ?, 'STOCK_TRANSFER', ?,
              ?, ?, ?, ?, ?,
              ?, 1, ?, 0, 0, ?,
              ?, ?
            )
          `).run(
            lossMovementId,
            transfer.businessId,
            transfer.destinationBranchId,
            transferLine.productId,
            transferLine.variantId || null,
            inTransitLocationId,
            lossScaled,
            transferLine.unitId || null,
            transferLine.unitCostMinor || null,
            transferLine.unitCostMinor != null ? Math.round((transferLine.unitCostMinor * lossScaled) / 1000) : null,
            transfer.id,
            transferLine.id,
            lossIdempotency,
            now,
            now,
            String(actor.userId),
            now,
            lossScaled / 1000,
            lossScaled,
            `In-transit loss: ${lineInput.discrepancyReason || 'Missing/Lost in transit'}`,
            Number(actor.userId) || 1
          );
        }

        // 6. Record receipt line
        this.db.prepare(`
          INSERT INTO stock_transfer_receipt_lines (
            id, receipt_id, transfer_line_id, product_id, received_quantity_scaled,
            rejected_quantity_scaled, loss_quantity_scaled, rejected_location_id,
            discrepancy_reason, discrepancy_action, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          randomUUID(),
          receiptId,
          transferLine.id,
          transferLine.productId,
          receivedScaled,
          rejectedScaled,
          lossScaled,
          lineInput.rejectedLocationId || null,
          lineInput.discrepancyReason || null,
          lineInput.discrepancyAction || null,
          lineInput.notes || null
        );

        // 7. Update cumulative quantities on transfer line
        this.db.prepare(`
          UPDATE stock_transfer_lines
          SET received_quantity_scaled = received_quantity_scaled + ?,
              rejected_quantity_scaled = rejected_quantity_scaled + ?,
              loss_quantity_scaled = loss_quantity_scaled + ?
          WHERE id = ?
        `).run(receivedScaled, rejectedScaled, lossScaled, transferLine.id);
      }

      // Check all lines of transfer to see if any lines still have remaining in-transit
      const currentLines = this.db
        .prepare(`
          SELECT dispatched_quantity_scaled, received_quantity_scaled,
                 rejected_quantity_scaled, loss_quantity_scaled
          FROM stock_transfer_lines
          WHERE transfer_id = ?
        `)
        .all(transfer.id) as any[];

      const isFullyFinished = currentLines.every(
        (l) => (l.received_quantity_scaled + l.rejected_quantity_scaled + l.loss_quantity_scaled) >= l.dispatched_quantity_scaled
      );

      const targetStatus: StockTransferStatus = isFullyFinished ? 'received' : 'partially_received';

      this.db.prepare(`
        UPDATE stock_transfers
        SET status = ?,
            received_by = ?,
            received_at = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        targetStatus,
        String(actor.userId),
        now,
        now,
        transfer.id
      );
    });

    tx();
    return this.transferRepo.getTransferById(transfer.id)!;
  }

  /**
   * Cancels a stock transfer if not yet dispatched.
   */
  public cancelTransfer(
    id: string,
    reason: string,
    actor: TransferActorContext
  ): StockTransfer {
    const transfer = this.transferRepo.getTransferById(id);
    if (!transfer) {
      throw new Error(`Stock transfer "${id}" not found.`);
    }

    StockTransferRules.validateStatusTransition(transfer.status, 'cancelled');

    const now = new Date().toISOString();
    const updatedNotes = transfer.notes
      ? `${transfer.notes} | Cancelled: ${reason}`
      : `Cancelled: ${reason}`;

    this.db.prepare(`
      UPDATE stock_transfers
      SET status = 'cancelled',
          notes = ?,
          updated_at = ?
      WHERE id = ?
    `).run(updatedNotes, now, id);

    return this.transferRepo.getTransferById(id)!;
  }

  /**
   * Retrieves single stock transfer.
   */
  public getTransferById(id: string): StockTransfer | null {
    return this.transferRepo.getTransferById(id);
  }

  /**
   * Lists stock transfers with filtering.
   */
  public listTransfers(filter: StockTransferFilter): StockTransfer[] {
    return this.transferRepo.listTransfers(filter);
  }
}
