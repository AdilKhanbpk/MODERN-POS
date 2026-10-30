import Database from 'better-sqlite3';
import {
  StockLocation,
  CreateStockLocationDto,
  UpdateStockLocationDto,
  CounterStockLocation
} from '../../../shared/types/stock-location';
import { StockLocationRules } from '../../../domain/inventory/stock-location-rules';

import { getDatabase } from '../connection';

export class StockLocationRepository {
  constructor(private db: Database.Database = getDatabase()) {}

  public create(dto: CreateStockLocationDto, createdBy?: string | null): StockLocation {
    const id = crypto.randomUUID();

    // Check duplicate code in same branch
    const existing = this.db
      .prepare('SELECT id FROM stock_locations WHERE branch_id = ? AND code = ?')
      .get(dto.branchId, dto.code.trim().toUpperCase());
    if (existing) {
      throw new Error(`Location code "${dto.code}" already exists in this branch.`);
    }

    // Default sellable rule: damaged and quarantine are not sellable by default
    let isSellable = dto.isSellable !== undefined ? (dto.isSellable ? 1 : 0) : 1;
    if (dto.locationType === 'damaged' || dto.locationType === 'quarantine') {
      isSellable = 0;
    }

    const isReceivable = dto.isReceivable !== undefined ? (dto.isReceivable ? 1 : 0) : 1;
    const isDefault = dto.isDefault ? 1 : 0;
    const isActive = dto.isActive !== undefined ? (dto.isActive ? 1 : 0) : 1;

    // If setting as default, clear existing default for this branch
    if (isDefault === 1 && isActive === 1) {
      this.db
        .prepare('UPDATE stock_locations SET is_default = 0 WHERE branch_id = ?')
        .run(dto.branchId);
    }

    this.db
      .prepare(
        `INSERT INTO stock_locations (
          id, business_id, branch_id, parent_location_id, name, code,
          location_type, is_default, is_sellable, is_receivable, is_active,
          created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        dto.businessId,
        dto.branchId,
        dto.parentLocationId || null,
        dto.name.trim(),
        dto.code.trim().toUpperCase(),
        dto.locationType,
        isDefault,
        isSellable,
        isReceivable,
        isActive,
        createdBy || null
      );

    return this.findById(id, dto.businessId)!;
  }

  public update(
    id: string,
    dto: UpdateStockLocationDto,
    businessId: string
  ): StockLocation {
    const current = this.findById(id, businessId);
    if (!current) {
      throw new Error(`Stock location "${id}" not found.`);
    }

    // If updating code, check duplicate in same branch
    if (dto.code && dto.code.trim().toUpperCase() !== current.code) {
      const existing = this.db
        .prepare('SELECT id FROM stock_locations WHERE branch_id = ? AND code = ? AND id != ?')
        .get(current.branchId, dto.code.trim().toUpperCase(), id);
      if (existing) {
        throw new Error(`Location code "${dto.code}" already exists in this branch.`);
      }
    }

    const name = dto.name !== undefined ? dto.name.trim() : current.name;
    const code = dto.code !== undefined ? dto.code.trim().toUpperCase() : current.code;
    const locationType = dto.locationType || current.locationType;
    const parentLocationId =
      dto.parentLocationId !== undefined ? dto.parentLocationId : current.parentLocationId;

    let isSellable =
      dto.isSellable !== undefined ? (dto.isSellable ? 1 : 0) : current.isSellable ? 1 : 0;
    if (locationType === 'damaged' || locationType === 'quarantine') {
      isSellable = 0;
    }

    const isReceivable =
      dto.isReceivable !== undefined ? (dto.isReceivable ? 1 : 0) : current.isReceivable ? 1 : 0;
    const isActive =
      dto.isActive !== undefined ? (dto.isActive ? 1 : 0) : current.isActive ? 1 : 0;
    const isDefault =
      dto.isDefault !== undefined ? (dto.isDefault ? 1 : 0) : current.isDefault ? 1 : 0;

    // Rule 14: If default location is being deactivated or unset, ensure another active default exists
    if (current.isDefault && (isActive === 0 || isDefault === 0)) {
      const otherDefault = this.db
        .prepare(
          'SELECT id FROM stock_locations WHERE branch_id = ? AND is_default = 1 AND is_active = 1 AND id != ?'
        )
        .get(current.branchId, id);
      if (!otherDefault) {
        throw new Error(
          'Cannot deactivate or remove the default status without assigning another valid default location for this branch first.'
        );
      }
    }

    // If becoming default, unset existing default in same branch
    if (isDefault === 1 && isActive === 1) {
      this.db
        .prepare('UPDATE stock_locations SET is_default = 0 WHERE branch_id = ? AND id != ?')
        .run(current.branchId, id);
    }

    this.db
      .prepare(
        `UPDATE stock_locations
         SET name = ?, code = ?, parent_location_id = ?, location_type = ?,
             is_default = ?, is_sellable = ?, is_receivable = ?, is_active = ?,
             updated_at = (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
         WHERE id = ? AND business_id = ?`
      )
      .run(
        name,
        code,
        parentLocationId || null,
        locationType,
        isDefault,
        isSellable,
        isReceivable,
        isActive,
        id,
        businessId
      );

    return this.findById(id, businessId)!;
  }

  public findById(id: string, businessId?: string): StockLocation | null {
    let sql = `
      SELECT l.*,
             p.name AS parent_name,
             b.name AS branch_name
      FROM stock_locations l
      LEFT JOIN stock_locations p ON l.parent_location_id = p.id
      LEFT JOIN branches b ON l.branch_id = b.id
      WHERE l.id = ?
    `;
    const params: any[] = [id];
    if (businessId) {
      sql += ' AND l.business_id = ?';
      params.push(businessId);
    }
    const row = this.db.prepare(sql).get(...params) as any;

    if (!row) return null;

    return {
      id: row.id,
      businessId: row.business_id,
      branchId: row.branch_id,
      parentLocationId: row.parent_location_id,
      name: row.name,
      code: row.code,
      locationType: row.location_type,
      isDefault: Boolean(row.is_default),
      isSellable: Boolean(row.is_sellable),
      isReceivable: Boolean(row.is_receivable),
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by,
      parentName: row.parent_name,
      branchName: row.branch_name
    };
  }

  public findByCode(code: string, branchId: string, businessId: string): StockLocation | null {
    const row = this.db
      .prepare(
        `SELECT l.*, p.name AS parent_name, b.name AS branch_name
         FROM stock_locations l
         LEFT JOIN stock_locations p ON l.parent_location_id = p.id
         LEFT JOIN branches b ON l.branch_id = b.id
         WHERE l.code = ? AND l.branch_id = ? AND l.business_id = ?`
      )
      .get(code.trim().toUpperCase(), branchId, businessId) as any;

    if (!row) return null;
    return {
      id: row.id,
      businessId: row.business_id,
      branchId: row.branch_id,
      parentLocationId: row.parent_location_id,
      name: row.name,
      code: row.code,
      locationType: row.location_type,
      isDefault: Boolean(row.is_default),
      isSellable: Boolean(row.is_sellable),
      isReceivable: Boolean(row.is_receivable),
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by,
      parentName: row.parent_name,
      branchName: row.branch_name
    };
  }

  public findAll(businessId: string, branchId?: string, includeInactive = false): StockLocation[] {
    let sql = `
      SELECT l.*,
             p.name AS parent_name,
             b.name AS branch_name
      FROM stock_locations l
      LEFT JOIN stock_locations p ON l.parent_location_id = p.id
      LEFT JOIN branches b ON l.branch_id = b.id
      WHERE l.business_id = ?
    `;
    const params: any[] = [businessId];

    if (branchId) {
      sql += ' AND l.branch_id = ?';
      params.push(branchId);
    }

    if (!includeInactive) {
      sql += ' AND l.is_active = 1';
    }

    sql += ' ORDER BY l.is_default DESC, l.name ASC';

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((row) => ({
      id: row.id,
      businessId: row.business_id,
      branchId: row.branch_id,
      parentLocationId: row.parent_location_id,
      name: row.name,
      code: row.code,
      locationType: row.location_type,
      isDefault: Boolean(row.is_default),
      isSellable: Boolean(row.is_sellable),
      isReceivable: Boolean(row.is_receivable),
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by,
      parentName: row.parent_name,
      branchName: row.branch_name
    }));
  }

  public getDefaultLocation(branchId: string, businessId: string): StockLocation | null {
    const row = this.db
      .prepare(
        `SELECT l.*, p.name AS parent_name, b.name AS branch_name
         FROM stock_locations l
         LEFT JOIN stock_locations p ON l.parent_location_id = p.id
         LEFT JOIN branches b ON l.branch_id = b.id
         WHERE l.branch_id = ? AND l.business_id = ? AND l.is_default = 1 AND l.is_active = 1`
      )
      .get(branchId, businessId) as any;

    if (!row) {
      // Fallback to any active sellable location in branch
      const fallback = this.db
        .prepare(
          `SELECT l.*, p.name AS parent_name, b.name AS branch_name
           FROM stock_locations l
           LEFT JOIN stock_locations p ON l.parent_location_id = p.id
           LEFT JOIN branches b ON l.branch_id = b.id
           WHERE l.branch_id = ? AND l.business_id = ? AND l.is_active = 1
           ORDER BY l.is_sellable DESC, l.created_at ASC LIMIT 1`
        )
        .get(branchId, businessId) as any;
      if (!fallback) return null;
      return {
        id: fallback.id,
        businessId: fallback.business_id,
        branchId: fallback.branch_id,
        parentLocationId: fallback.parent_location_id,
        name: fallback.name,
        code: fallback.code,
        locationType: fallback.location_type,
        isDefault: Boolean(fallback.is_default),
        isSellable: Boolean(fallback.is_sellable),
        isReceivable: Boolean(fallback.is_receivable),
        isActive: Boolean(fallback.is_active),
        createdAt: fallback.created_at,
        updatedAt: fallback.updated_at,
        createdBy: fallback.created_by,
        parentName: fallback.parent_name,
        branchName: fallback.branch_name
      };
    }

    return {
      id: row.id,
      businessId: row.business_id,
      branchId: row.branch_id,
      parentLocationId: row.parent_location_id,
      name: row.name,
      code: row.code,
      locationType: row.location_type,
      isDefault: Boolean(row.is_default),
      isSellable: Boolean(row.is_sellable),
      isReceivable: Boolean(row.is_receivable),
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by,
      parentName: row.parent_name,
      branchName: row.branch_name
    };
  }

  public getCounterDefaultLocation(counterId: string, businessId: string): StockLocation | null {
    const mapping = this.db
      .prepare(
        `SELECT l.*, p.name AS parent_name, b.name AS branch_name
         FROM counter_stock_locations csl
         JOIN stock_locations l ON csl.stock_location_id = l.id
         LEFT JOIN stock_locations p ON l.parent_location_id = p.id
         LEFT JOIN branches b ON l.branch_id = b.id
         WHERE csl.counter_id = ? AND csl.business_id = ? AND csl.is_default = 1 AND l.is_active = 1`
      )
      .get(counterId, businessId) as any;

    if (!mapping) return null;

    return {
      id: mapping.id,
      businessId: mapping.business_id,
      branchId: mapping.branch_id,
      parentLocationId: mapping.parent_location_id,
      name: mapping.name,
      code: mapping.code,
      locationType: mapping.location_type,
      isDefault: Boolean(mapping.is_default),
      isSellable: Boolean(mapping.is_sellable),
      isReceivable: Boolean(mapping.is_receivable),
      isActive: Boolean(mapping.is_active),
      createdAt: mapping.created_at,
      updatedAt: mapping.updated_at,
      createdBy: mapping.created_by,
      parentName: mapping.parent_name,
      branchName: mapping.branch_name
    };
  }

  public setCounterDefaultLocation(
    counterId: string,
    stockLocationId: string,
    businessId: string
  ): void {
    // Check location belongs to same business
    const loc = this.findById(stockLocationId, businessId);
    if (!loc) {
      throw new Error(`Stock location "${stockLocationId}" not found for this business.`);
    }

    // Unset other defaults for this counter
    this.db
      .prepare('UPDATE counter_stock_locations SET is_default = 0 WHERE counter_id = ?')
      .run(counterId);

    // Upsert mapping
    this.db
      .prepare(
        `INSERT INTO counter_stock_locations (id, business_id, counter_id, stock_location_id, is_default)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(counter_id, stock_location_id) DO UPDATE SET is_default = 1`
      )
      .run(crypto.randomUUID(), businessId, counterId, stockLocationId);
  }

  public isReferenced(locationId: string): boolean {
    // Check movements
    const move = this.db
      .prepare('SELECT 1 FROM stock_movements WHERE stock_location_id = ? OR location_id = ? LIMIT 1')
      .get(locationId, locationId);
    if (move) return true;

    // Check transfers
    const transfer = this.db
      .prepare(
        'SELECT 1 FROM stock_transfers WHERE source_location_id = ? OR destination_location_id = ? LIMIT 1'
      )
      .get(locationId, locationId);
    if (transfer) return true;

    // Check balances with activity
    const balance = this.db
      .prepare(
        'SELECT 1 FROM stock_balances WHERE stock_location_id = ? AND (on_hand_scaled != 0 OR reserved_scaled != 0) LIMIT 1'
      )
      .get(locationId);
    if (balance) return true;

    // Check children
    const child = this.db
      .prepare('SELECT 1 FROM stock_locations WHERE parent_location_id = ? LIMIT 1')
      .get(locationId);
    if (child) return true;

    return false;
  }

  public delete(id: string, businessId: string): void {
    const loc = this.findById(id, businessId);
    if (!loc) {
      throw new Error(`Location "${id}" not found.`);
    }

    if (this.isReferenced(id)) {
      throw new Error(
        'Location cannot be permanently deleted because historical inventory movements, transfers, or children reference it. Use archive instead.'
      );
    }

    this.db
      .prepare('DELETE FROM stock_locations WHERE id = ? AND business_id = ?')
      .run(id, businessId);
  }
}

