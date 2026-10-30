import Database from 'better-sqlite3';
import { getDatabase } from '../connection';
import {
  EnterpriseStockAdjustment,
  EnterpriseStockAdjustmentDetail,
  StockAdjustmentLine,
  StockAdjustmentApprovalPolicy,
  StockAdjustmentFilters,
  PaginatedAdjustmentsResult,
  StockAdjustmentStatus
} from '../../../shared/types/stock-adjustment';

export class StockAdjustmentRepository {
  constructor(private db: Database.Database = getDatabase()) {}

  public getDb(): Database.Database {
    return this.db;
  }

  public getNextAdjustmentNumber(businessId: string): string {
    const year = new Date().getFullYear();
    const prefix = `ADJ-${year}-`;
    const row = this.db
      .prepare(
        `SELECT adjustment_number FROM stock_adjustments
         WHERE business_id = ? AND adjustment_number LIKE ?
         ORDER BY adjustment_number DESC LIMIT 1`
      )
      .get(businessId, `${prefix}%`) as { adjustment_number: string } | undefined;

    let nextSeq = 1;
    if (row && row.adjustment_number) {
      const parts = row.adjustment_number.split('-');
      const lastSeq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastSeq)) {
        nextSeq = lastSeq + 1;
      }
    }

    return `${prefix}${String(nextSeq).padStart(5, '0')}`;
  }

  public create(
    adjustment: EnterpriseStockAdjustment,
    lines: StockAdjustmentLine[]
  ): EnterpriseStockAdjustmentDetail {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO stock_adjustments (
            id, business_id, branch_id, adjustment_number, stock_location_id,
            adjustment_type, reason_code, reason_description, status,
            requested_by, approved_by, posted_by, requested_at, approved_at,
            posted_at, idempotency_key, reversal_of_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          adjustment.id,
          adjustment.businessId,
          adjustment.branchId,
          adjustment.adjustmentNumber,
          adjustment.stockLocationId,
          adjustment.adjustmentType,
          adjustment.reasonCode,
          adjustment.reasonDescription,
          adjustment.status,
          adjustment.requestedBy,
          adjustment.approvedBy || null,
          adjustment.postedBy || null,
          adjustment.requestedAt,
          adjustment.approvedAt || null,
          adjustment.postedAt || null,
          adjustment.idempotencyKey,
          adjustment.reversalOfId || null,
          adjustment.createdAt,
          adjustment.updatedAt
        );

      const insertLine = this.db.prepare(
        `INSERT INTO stock_adjustment_lines (
          id, adjustment_id, product_id, variant_id, batch_id,
          system_quantity_scaled, counted_quantity_scaled, difference_quantity_scaled,
          unit_id, unit_cost_minor, total_value_minor, reason, created_at,
          system_quantity, counted_quantity, difference_quantity
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const line of lines) {
        insertLine.run(
          line.id,
          adjustment.id,
          line.productId,
          line.variantId || null,
          line.batchId || null,
          line.systemQuantityScaled,
          line.countedQuantityScaled,
          line.differenceQuantityScaled,
          line.unitId,
          line.unitCostMinor || null,
          line.totalValueMinor || null,
          line.reason || null,
          line.createdAt || adjustment.createdAt,
          line.systemQuantityScaled / 1000,
          line.countedQuantityScaled / 1000,
          line.differenceQuantityScaled / 1000
        );
      }
    });

    tx();
    return this.findById(adjustment.id)!;
  }

  public findById(id: string): EnterpriseStockAdjustmentDetail | null {
    const row = this.db
      .prepare(
        `SELECT a.*,
                l.name AS stock_location_name,
                u1.full_name AS requested_by_name,
                u2.full_name AS approved_by_name,
                u3.full_name AS posted_by_name
         FROM stock_adjustments a
         LEFT JOIN stock_locations l ON a.stock_location_id = l.id
         LEFT JOIN users u1 ON a.requested_by = u1.id
         LEFT JOIN users u2 ON a.approved_by = u2.id
         LEFT JOIN users u3 ON a.posted_by = u3.id
         WHERE a.id = ?`
      )
      .get(id) as any;

    if (!row) return null;

    const lineRows = this.db
      .prepare(
        `SELECT l.*,
                p.name AS product_name,
                p.sku AS product_sku,
                u.name AS unit_name
         FROM stock_adjustment_lines l
         LEFT JOIN products p ON l.product_id = p.id
         LEFT JOIN units u ON l.unit_id = u.id
         WHERE l.adjustment_id = ?
         ORDER BY l.created_at ASC`
      )
      .all(id) as any[];

    const lines: StockAdjustmentLine[] = lineRows.map((r) => ({
      id: r.id,
      adjustmentId: r.adjustment_id,
      productId: String(r.product_id),
      productName: r.product_name || undefined,
      productSku: r.product_sku || undefined,
      variantId: r.variant_id ? String(r.variant_id) : null,
      batchId: r.batch_id ? String(r.batch_id) : null,
      systemQuantityScaled: Number(r.system_quantity_scaled),
      countedQuantityScaled: Number(r.counted_quantity_scaled),
      differenceQuantityScaled: Number(r.difference_quantity_scaled),
      unitId: String(r.unit_id),
      unitName: r.unit_name || undefined,
      unitCostMinor: r.unit_cost_minor != null ? Number(r.unit_cost_minor) : null,
      totalValueMinor: r.total_value_minor != null ? Number(r.total_value_minor) : null,
      reason: r.reason || null,
      createdAt: r.created_at
    }));

    const totalDiff = lines.reduce((sum, l) => sum + l.differenceQuantityScaled, 0);
    const totalVal = lines.reduce((sum, l) => sum + (l.totalValueMinor || 0), 0);

    return {
      id: row.id,
      businessId: row.business_id,
      branchId: row.branch_id,
      adjustmentNumber: row.adjustment_number,
      stockLocationId: row.stock_location_id,
      stockLocationName: row.stock_location_name,
      adjustmentType: row.adjustment_type,
      reasonCode: row.reason_code,
      reasonDescription: row.reason_description,
      status: row.status,
      requestedBy: String(row.requested_by),
      requestedByName: row.requested_by_name,
      approvedBy: row.approved_by ? String(row.approved_by) : null,
      approvedByName: row.approved_by_name,
      postedBy: row.posted_by ? String(row.posted_by) : null,
      postedByName: row.posted_by_name,
      requestedAt: row.requested_at,
      approvedAt: row.approved_at,
      postedAt: row.posted_at,
      idempotencyKey: row.idempotency_key,
      reversalOfId: row.reversal_of_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lines,
      totalDifferenceScaled: totalDiff,
      totalValueImpactMinor: totalVal
    };
  }

  public findByIdempotencyKey(
    businessId: string,
    idempotencyKey: string
  ): EnterpriseStockAdjustmentDetail | null {
    const row = this.db
      .prepare('SELECT id FROM stock_adjustments WHERE business_id = ? AND idempotency_key = ?')
      .get(businessId, idempotencyKey) as { id: string } | undefined;

    return row ? this.findById(row.id) : null;
  }

  public updateStatus(
    id: string,
    status: StockAdjustmentStatus,
    updates: {
      approvedBy?: string | null;
      approvedAt?: string | null;
      postedBy?: string | null;
      postedAt?: string | null;
    } = {}
  ): void {
    const sets = [
      'status = ?',
      "updated_at = (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))"
    ];
    const params: any[] = [status];

    if (updates.approvedBy !== undefined) {
      sets.push('approved_by = ?');
      params.push(updates.approvedBy);
    }
    if (updates.approvedAt !== undefined) {
      sets.push('approved_at = ?');
      params.push(updates.approvedAt);
    }
    if (updates.postedBy !== undefined) {
      sets.push('posted_by = ?');
      params.push(updates.postedBy);
    }
    if (updates.postedAt !== undefined) {
      sets.push('posted_at = ?');
      params.push(updates.postedAt);
    }

    params.push(id);
    this.db.prepare(`UPDATE stock_adjustments SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  public updateLineSnapshot(
    lineId: string,
    systemQuantityScaled: number,
    differenceQuantityScaled: number,
    totalValueMinor?: number | null
  ): void {
    this.db
      .prepare(
        `UPDATE stock_adjustment_lines
         SET system_quantity_scaled = ?,
             difference_quantity_scaled = ?,
             total_value_minor = ?,
             system_quantity = ?,
             difference_quantity = ?
         WHERE id = ?`
      )
      .run(
        systemQuantityScaled,
        differenceQuantityScaled,
        totalValueMinor || null,
        systemQuantityScaled / 1000,
        differenceQuantityScaled / 1000,
        lineId
      );
  }

  public list(filters: StockAdjustmentFilters): PaginatedAdjustmentsResult {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filters.businessId) {
      conditions.push('a.business_id = ?');
      params.push(filters.businessId);
    }
    if (filters.branchId) {
      conditions.push('a.branch_id = ?');
      params.push(filters.branchId);
    }
    if (filters.stockLocationId) {
      conditions.push('a.stock_location_id = ?');
      params.push(filters.stockLocationId);
    }
    if (filters.status) {
      conditions.push('a.status = ?');
      params.push(filters.status);
    }
    if (filters.adjustmentType) {
      conditions.push('a.adjustment_type = ?');
      params.push(filters.adjustmentType);
    }
    if (filters.reasonCode) {
      conditions.push('a.reason_code = ?');
      params.push(filters.reasonCode);
    }
    if (filters.startDate) {
      conditions.push('a.requested_at >= ?');
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      conditions.push('a.requested_at <= ?');
      params.push(filters.endDate);
    }
    if (filters.search) {
      conditions.push('(a.adjustment_number LIKE ? OR a.reason_description LIKE ?)');
      params.push(`%${filters.search}%`, `%${filters.search}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = this.db
      .prepare(`SELECT COUNT(*) as count FROM stock_adjustments a ${whereClause}`)
      .get(...params) as { count: number };
    const total = countRow.count;

    const page = Math.max(1, filters.page || 1);
    const limit = Math.max(1, Math.min(100, filters.limit || 20));
    const offset = (page - 1) * limit;

    const rows = this.db
      .prepare(
        `SELECT a.*,
                l.name AS stock_location_name,
                u1.full_name AS requested_by_name,
                u2.full_name AS approved_by_name,
                u3.full_name AS posted_by_name,
                (SELECT COUNT(*) FROM stock_adjustment_lines WHERE adjustment_id = a.id) as line_count,
                (SELECT COALESCE(SUM(difference_quantity_scaled), 0) FROM stock_adjustment_lines WHERE adjustment_id = a.id) as total_diff_scaled,
                (SELECT COALESCE(SUM(total_value_minor), 0) FROM stock_adjustment_lines WHERE adjustment_id = a.id) as total_val_minor
         FROM stock_adjustments a
         LEFT JOIN stock_locations l ON a.stock_location_id = l.id
         LEFT JOIN users u1 ON a.requested_by = u1.id
         LEFT JOIN users u2 ON a.approved_by = u2.id
         LEFT JOIN users u3 ON a.posted_by = u3.id
         ${whereClause}
         ORDER BY a.requested_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as any[];

    const items: EnterpriseStockAdjustment[] = rows.map((r) => ({
      id: r.id,
      businessId: r.business_id,
      branchId: r.branch_id,
      adjustmentNumber: r.adjustment_number,
      stockLocationId: r.stock_location_id,
      stockLocationName: r.stock_location_name,
      adjustmentType: r.adjustment_type,
      reasonCode: r.reason_code,
      reasonDescription: r.reason_description,
      status: r.status,
      requestedBy: String(r.requested_by),
      requestedByName: r.requested_by_name,
      approvedBy: r.approved_by ? String(r.approved_by) : null,
      approvedByName: r.approved_by_name,
      postedBy: r.posted_by ? String(r.posted_by) : null,
      postedByName: r.posted_by_name,
      requestedAt: r.requested_at,
      approvedAt: r.approved_at,
      postedAt: r.posted_at,
      idempotencyKey: r.idempotency_key,
      reversalOfId: r.reversal_of_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      totalDifferenceScaled: Number(r.total_diff_scaled),
      totalValueImpactMinor: Number(r.total_val_minor)
    }));

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  }

  public getPolicy(businessId: string): StockAdjustmentApprovalPolicy | null {
    const row = this.db
      .prepare('SELECT * FROM stock_adjustment_approval_policies WHERE business_id = ?')
      .get(businessId) as any;

    if (!row) return null;

    let types: any[] = [];
    try {
      types = JSON.parse(row.require_approval_for_types || '[]');
    } catch {
      types = ['damage', 'expiry', 'other'];
    }

    let roles: string[] = [];
    try {
      roles = JSON.parse(row.approver_roles || '[]');
    } catch {
      roles = ['OWNER', 'ADMINISTRATOR', 'MANAGER'];
    }

    return {
      id: row.id,
      businessId: row.business_id,
      maxAutoApproveQtyScaled: Number(row.max_auto_approve_qty_scaled),
      maxAutoApproveValueMinor: Number(row.max_auto_approve_value_minor),
      requireApprovalForTypes: types,
      allowSelfApproval: Boolean(row.allow_self_approval),
      approverRoles: roles,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  public upsertPolicy(policy: StockAdjustmentApprovalPolicy): void {
    this.db
      .prepare(
        `INSERT INTO stock_adjustment_approval_policies (
          id, business_id, max_auto_approve_qty_scaled, max_auto_approve_value_minor,
          require_approval_for_types, allow_self_approval, approver_roles,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')), (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')))
        ON CONFLICT(business_id) DO UPDATE SET
          max_auto_approve_qty_scaled = excluded.max_auto_approve_qty_scaled,
          max_auto_approve_value_minor = excluded.max_auto_approve_value_minor,
          require_approval_for_types = excluded.require_approval_for_types,
          allow_self_approval = excluded.allow_self_approval,
          approver_roles = excluded.approver_roles,
          updated_at = (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))`
      )
      .run(
        policy.id,
        policy.businessId,
        policy.maxAutoApproveQtyScaled,
        policy.maxAutoApproveValueMinor,
        JSON.stringify(policy.requireApprovalForTypes),
        policy.allowSelfApproval ? 1 : 0,
        JSON.stringify(policy.approverRoles)
      );
  }
}

