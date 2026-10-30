"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductCatalogService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const AppError_1 = require("../../shared/errors/AppError");
const category_hierarchy_1 = require("../../domain/catalogue/category-hierarchy");
const price_rules_1 = require("../../domain/catalogue/price-rules");
const connection_1 = require("../../infrastructure/sqlite/connection");
class ProductCatalogService {
    db;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
    }
    // =========================================================================
    // 1. PRODUCT CRUD & SAFETY
    // =========================================================================
    createProduct(dto, userId) {
        // 1. Verify business exists
        const biz = this.db.prepare('SELECT id FROM businesses WHERE id = ?').get(dto.businessId);
        if (!biz) {
            throw new AppError_1.NotFoundError('Business', dto.businessId);
        }
        // 2. Validate SKU uniqueness within the business
        const existingSku = this.db.prepare('SELECT id FROM products WHERE business_id = ? AND sku = ?').get(dto.businessId, dto.sku);
        if (existingSku) {
            throw new AppError_1.ConflictError(`Product SKU "${dto.sku}" already exists for this business.`);
        }
        // 3. Validate base unit
        const unit = this.db.prepare('SELECT id, name FROM units WHERE id = ?').get(dto.baseUnitId);
        if (!unit) {
            throw new AppError_1.ValidationError(`Base unit not found with id "${dto.baseUnitId}".`);
        }
        // 4. Validate category if provided
        if (dto.categoryId) {
            const cat = this.db.prepare('SELECT id FROM product_categories WHERE id = ? AND business_id = ?').get(dto.categoryId, dto.businessId);
            if (!cat) {
                throw new AppError_1.ValidationError(`Product category not found with id "${dto.categoryId}" for this business.`);
            }
        }
        // 5. Validate brand if provided
        if (dto.brandId) {
            const brand = this.db.prepare('SELECT id FROM brands WHERE id = ? AND business_id = ?').get(dto.brandId, dto.businessId);
            if (!brand) {
                throw new AppError_1.ValidationError(`Brand not found with id "${dto.brandId}" for this business.`);
            }
        }
        const productId = crypto_1.default.randomUUID();
        const productType = dto.productType || 'standard';
        const costMethod = dto.costMethod || 'weighted_average';
        const trackStock = dto.trackStock !== false ? 1 : 0;
        const allowNegativeStock = dto.allowNegativeStock ? 1 : 0;
        const isActive = dto.isActive !== false ? 1 : 0;
        const purchaseCost = dto.purchaseCostMinor ?? dto.costPrice ?? 0;
        const retailPrice = dto.retailPriceMinor || 0;
        const openingStock = dto.openingStockScaled || 0;
        const lowStock = dto.lowStockThreshold || 5;
        const taxRate = dto.taxRate || 0;
        const isTaxInclusive = dto.isTaxInclusive ? 1 : 0;
        const tx = this.db.transaction(() => {
            // Insert product master
            this.db.prepare(`
        INSERT INTO products (
          id, business_id, sku, name, description, category_id, brand_id, product_type,
          base_unit_id, default_sale_unit_id, default_purchase_unit_id, cost_method,
          track_stock, allow_negative_stock, is_active, image_path, created_by,
          barcode, base_unit, cost_price, selling_price, default_cost_minor, default_sale_price_minor,
          current_stock, min_stock_level, tax_rate, is_tax_inclusive
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(productId, dto.businessId, dto.sku, dto.name, dto.description || null, dto.categoryId || null, dto.brandId || null, productType, dto.baseUnitId, dto.defaultSaleUnitId || dto.baseUnitId, dto.defaultPurchaseUnitId || dto.baseUnitId, costMethod, trackStock, allowNegativeStock, isActive, dto.imagePath || null, userId || dto.createdBy || null, dto.barcode || null, unit.name, purchaseCost, retailPrice, purchaseCost, retailPrice, openingStock, lowStock, taxRate, isTaxInclusive);
            // Insert product details if any optional attributes specified
            if (dto.details) {
                this.db.prepare(`
          INSERT INTO product_details (
            product_id, manufacturer, model_number, country_of_origin, warranty_months, custom_attributes
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(productId, dto.details.manufacturer || null, dto.details.modelNumber || null, dto.details.countryOfOrigin || null, dto.details.warrantyMonths || null, dto.details.customAttributes ? JSON.stringify(dto.details.customAttributes) : null);
            }
            // Insert initial retail price
            if (retailPrice > 0) {
                this.createProductPrice({
                    businessId: dto.businessId,
                    productId,
                    priceType: 'retail',
                    unitId: dto.baseUnitId,
                    amountMinor: retailPrice
                });
            }
            // Insert initial wholesale price if provided
            if (dto.wholesalePriceMinor && dto.wholesalePriceMinor > 0) {
                this.createProductPrice({
                    businessId: dto.businessId,
                    productId,
                    priceType: 'wholesale',
                    unitId: dto.baseUnitId,
                    amountMinor: dto.wholesalePriceMinor
                });
            }
            // If opening stock is specified, record stock projection
            if (openingStock > 0) {
                try {
                    const cols = this.db.prepare("PRAGMA table_info(stock_balances)").all();
                    if (cols.some((c) => c.name === 'stock_location_id')) {
                        const defaultLoc = this.db.prepare("SELECT id, business_id FROM stock_locations WHERE (business_id = ? OR business_id IS NULL) AND is_sellable = 1 AND is_active = 1 LIMIT 1").get(dto.businessId);
                        if (defaultLoc) {
                            const scaled = openingStock * 1000;
                            this.db.prepare(`
                INSERT OR REPLACE INTO stock_balances (
                  id, business_id, product_id, stock_location_id, on_hand_scaled, available_scaled
                ) VALUES (?, ?, ?, ?, ?, ?)
              `).run(`bal-${productId}-${defaultLoc.id}`, defaultLoc.business_id, String(productId), defaultLoc.id, scaled, scaled);
                        }
                    }
                    else if (cols.some((c) => c.name === 'location_id')) {
                        this.db.prepare(`
              INSERT OR REPLACE INTO stock_balances (product_id, variant_id, location_id, batch_id, quantity_base_scaled)
              VALUES (?, 0, 1, 0, ?)
            `).run(productId, openingStock);
                    }
                }
                catch {
                    // ignore
                }
                try {
                    const moveCols = this.db.prepare("PRAGMA table_info(stock_movements)").all();
                    if (moveCols.some((c) => c.name === 'quantity_base_scaled')) {
                        this.db.prepare(`
              INSERT INTO stock_movements (
                product_id, location_id, movement_type, quantity, quantity_base_scaled,
                previous_stock, new_stock, reason, user_id
              )
              VALUES (?, 1, 'OPENING_BALANCE', ?, ?, 0, ?, 'Initial opening stock', ?)
            `).run(productId, openingStock, openingStock, openingStock, userId || null);
                    }
                }
                catch {
                    // ignore
                }
            }
        });
        tx();
        return this.getProductById(dto.businessId, productId);
    }
    updateProduct(id, dto, userId) {
        const existing = this.db.prepare('SELECT * FROM products WHERE id = ?').get(id);
        if (!existing) {
            throw new AppError_1.NotFoundError('Product', id);
        }
        const businessId = existing.business_id;
        // Check SKU collision if SKU changed
        if (dto.sku && dto.sku !== existing.sku) {
            const collision = this.db.prepare('SELECT id FROM products WHERE business_id = ? AND sku = ? AND id != ?').get(businessId, dto.sku, id);
            if (collision) {
                throw new AppError_1.ConflictError(`Product SKU "${dto.sku}" already exists for this business.`);
            }
        }
        // Validate category if changing
        if (dto.categoryId !== undefined) {
            if (dto.categoryId) {
                const cat = this.db.prepare('SELECT id FROM product_categories WHERE id = ? AND business_id = ?').get(dto.categoryId, businessId);
                if (!cat) {
                    throw new AppError_1.ValidationError(`Category not found with id "${dto.categoryId}".`);
                }
            }
        }
        const tx = this.db.transaction(() => {
            this.db.prepare(`
        UPDATE products
        SET sku = COALESCE(?, sku),
            name = COALESCE(?, name),
            description = CASE WHEN ? IS NOT NULL THEN ? ELSE description END,
            category_id = CASE WHEN ? IS NOT NULL THEN ? ELSE category_id END,
            brand_id = CASE WHEN ? IS NOT NULL THEN ? ELSE brand_id END,
            product_type = COALESCE(?, product_type),
            base_unit_id = COALESCE(?, base_unit_id),
            cost_method = COALESCE(?, cost_method),
            track_stock = CASE WHEN ? IS NOT NULL THEN ? ELSE track_stock END,
            allow_negative_stock = CASE WHEN ? IS NOT NULL THEN ? ELSE allow_negative_stock END,
            is_active = CASE WHEN ? IS NOT NULL THEN ? ELSE is_active END,
            barcode = CASE WHEN ? IS NOT NULL THEN ? ELSE barcode END,
            cost_price = COALESCE(?, cost_price),
            selling_price = COALESCE(?, selling_price),
            default_cost_minor = COALESCE(?, default_cost_minor),
            default_sale_price_minor = COALESCE(?, default_sale_price_minor),
            min_stock_level = COALESCE(?, min_stock_level),
            tax_rate = COALESCE(?, tax_rate),
            is_tax_inclusive = CASE WHEN ? IS NOT NULL THEN ? ELSE is_tax_inclusive END,
            image_path = CASE WHEN ? IS NOT NULL THEN ? ELSE image_path END,
            updated_at = (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
        WHERE id = ?
      `).run(dto.sku ?? null, dto.name ?? null, dto.description !== undefined ? dto.description : null, dto.description ?? null, dto.categoryId !== undefined ? dto.categoryId : null, dto.categoryId ?? null, dto.brandId !== undefined ? dto.brandId : null, dto.brandId ?? null, dto.productType ?? null, dto.baseUnitId ?? null, dto.costMethod ?? null, dto.trackStock !== undefined ? (dto.trackStock ? 1 : 0) : null, dto.trackStock !== undefined ? (dto.trackStock ? 1 : 0) : null, dto.allowNegativeStock !== undefined ? (dto.allowNegativeStock ? 1 : 0) : null, dto.allowNegativeStock !== undefined ? (dto.allowNegativeStock ? 1 : 0) : null, dto.isActive !== undefined ? (dto.isActive ? 1 : 0) : null, dto.isActive !== undefined ? (dto.isActive ? 1 : 0) : null, dto.barcode !== undefined ? dto.barcode : null, dto.barcode ?? null, dto.purchaseCostMinor ?? null, dto.retailPriceMinor ?? null, dto.purchaseCostMinor ?? null, dto.retailPriceMinor ?? null, dto.lowStockThreshold ?? null, dto.taxRate ?? null, dto.isTaxInclusive !== undefined ? (dto.isTaxInclusive ? 1 : 0) : null, dto.isTaxInclusive !== undefined ? (dto.isTaxInclusive ? 1 : 0) : null, dto.imagePath !== undefined ? dto.imagePath : null, dto.imagePath ?? null, id);
            if (dto.details) {
                this.db.prepare(`
          INSERT INTO product_details (
            product_id, manufacturer, model_number, country_of_origin, warranty_months, custom_attributes
          )
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(product_id) DO UPDATE SET
            manufacturer = COALESCE(excluded.manufacturer, product_details.manufacturer),
            model_number = COALESCE(excluded.model_number, product_details.model_number),
            country_of_origin = COALESCE(excluded.country_of_origin, product_details.country_of_origin),
            warranty_months = COALESCE(excluded.warranty_months, product_details.warranty_months),
            custom_attributes = COALESCE(excluded.custom_attributes, product_details.custom_attributes)
        `).run(id, dto.details.manufacturer || null, dto.details.modelNumber || null, dto.details.countryOfOrigin || null, dto.details.warrantyMonths || null, dto.details.customAttributes ? JSON.stringify(dto.details.customAttributes) : null);
            }
        });
        tx();
        return this.getProductById(businessId, id);
    }
    /**
     * Non-destructive archiving: Disables future sales while strictly preserving
     * all historical sale lines, purchase lines, stock movements, and price records.
     */
    archiveProduct(businessId, id) {
        const prod = this.db.prepare('SELECT id FROM products WHERE id = ? AND business_id = ?').get(id, businessId);
        if (!prod) {
            throw new AppError_1.NotFoundError('Product', id);
        }
        this.db.prepare(`
      UPDATE products
      SET is_active = 0, updated_at = (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
      WHERE id = ? AND business_id = ?
    `).run(id, businessId);
    }
    /**
     * Safety guard: If a product is referenced by any posted transaction or stock movement,
     * it CANNOT be physically deleted. Archiving must be used instead.
     */
    deleteProduct(businessId, id) {
        const prod = this.db.prepare('SELECT id, name FROM products WHERE id = ? AND business_id = ?').get(id, businessId);
        if (!prod) {
            throw new AppError_1.NotFoundError('Product', id);
        }
        // 1. Check sale items
        const saleItemCount = this.db.prepare('SELECT COUNT(*) as count FROM sale_items WHERE product_id = ?').get(id).count;
        // 2. Check stock movements
        const stockMoveCount = this.db.prepare('SELECT COUNT(*) as count FROM stock_movements WHERE product_id = ?').get(id).count;
        if (saleItemCount > 0 || stockMoveCount > 0) {
            throw new AppError_1.AppError(`Product "${prod.name}" cannot be deleted because it is referenced by existing transactions (${saleItemCount} sale items, ${stockMoveCount} stock movements). Archive the product instead to disable future sales.`, 'BUSINESS_RULE_ERROR', 409);
        }
        // If completely unreferenced, physical deletion is allowed
        this.db.prepare('DELETE FROM products WHERE id = ? AND business_id = ?').run(id, businessId);
    }
    /**
     * Clones a product and its details into a new record with a new SKU.
     */
    duplicateProduct(businessId, sourceProductId, newSku, newName) {
        const source = this.getProductById(businessId, sourceProductId);
        if (!source) {
            throw new AppError_1.NotFoundError('Product', sourceProductId);
        }
        return this.createProduct({
            businessId,
            sku: newSku,
            name: newName || `${source.name} (Copy)`,
            description: source.description || undefined,
            categoryId: source.categoryId || undefined,
            brandId: source.brandId || undefined,
            productType: source.productType,
            baseUnitId: source.baseUnitId,
            defaultSaleUnitId: source.defaultSaleUnitId || undefined,
            defaultPurchaseUnitId: source.defaultPurchaseUnitId || undefined,
            costMethod: source.costMethod,
            trackStock: source.trackStock,
            allowNegativeStock: source.allowNegativeStock,
            purchaseCostMinor: source.costPrice,
            retailPriceMinor: source.sellingPrice,
            lowStockThreshold: source.minStockLevel,
            taxRate: source.taxRate,
            isTaxInclusive: source.isTaxInclusive,
            imagePath: source.imagePath || undefined,
            details: source.details
                ? {
                    manufacturer: source.details.manufacturer || undefined,
                    modelNumber: source.details.modelNumber || undefined,
                    countryOfOrigin: source.details.countryOfOrigin || undefined,
                    warrantyMonths: source.details.warrantyMonths || undefined,
                    customAttributes: source.details.customAttributes || undefined
                }
                : undefined
        });
    }
    /**
     * Asserts that a product is active and eligible for sale at checkout.
     */
    assertProductCanBeSold(product) {
        const active = 'isActive' in product ? product.isActive : product.is_active === 1 || product.is_active === true;
        if (!active) {
            throw new AppError_1.AppError(`Cannot sell product "${product.name}": Product is archived / inactive.`, 'BUSINESS_RULE_ERROR', 422);
        }
    }
    // =========================================================================
    // 2. PRODUCT PRICING
    // =========================================================================
    createProductPrice(dto) {
        // 1. Fetch all existing active prices for the same (business_id, product_id, unit_id, price_type)
        const existing = this.db.prepare(`
      SELECT id, valid_from as validFrom, valid_to as validTo
      FROM product_prices
      WHERE business_id = ? AND product_id = ? AND unit_id = ? AND price_type = ? AND is_active = 1
    `).all(dto.businessId, dto.productId, dto.unitId, dto.priceType);
        // 2. Check for overlapping validity intervals
        (0, price_rules_1.assertNoPriceOverlap)({
            validFrom: dto.validFrom || null,
            validTo: dto.validTo || null
        }, existing);
        const priceId = crypto_1.default.randomUUID();
        const currency = dto.currencyCode || 'PKR';
        const minQty = dto.minimumQuantityScaled || 0;
        const isActive = dto.isActive !== false ? 1 : 0;
        this.db.prepare(`
      INSERT INTO product_prices (
        id, business_id, product_id, price_type, unit_id, amount_minor, currency_code,
        minimum_quantity_scaled, valid_from, valid_to, is_active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(priceId, dto.businessId, dto.productId, dto.priceType, dto.unitId, dto.amountMinor, currency, minQty, dto.validFrom || null, dto.validTo || null, isActive);
        return {
            id: priceId,
            businessId: dto.businessId,
            productId: dto.productId,
            priceType: dto.priceType,
            unitId: dto.unitId,
            amountMinor: dto.amountMinor,
            currencyCode: currency,
            minimumQuantityScaled: minQty,
            validFrom: dto.validFrom || null,
            validTo: dto.validTo || null,
            isActive: isActive === 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }
    getProductPrices(businessId, productId) {
        const rows = this.db.prepare(`
      SELECT id, business_id as businessId, product_id as productId, price_type as priceType,
             unit_id as unitId, amount_minor as amountMinor, currency_code as currencyCode,
             minimum_quantity_scaled as minimumQuantityScaled, valid_from as validFrom,
             valid_to as validTo, is_active as isActive, created_at as createdAt, updated_at as updatedAt
      FROM product_prices
      WHERE business_id = ? AND product_id = ?
      ORDER BY created_at DESC
    `).all(businessId, productId);
        return rows.map(r => ({
            ...r,
            isActive: Boolean(r.isActive)
        }));
    }
    // =========================================================================
    // 3. PRODUCT SEARCH & RETRIEVAL (Indexed & Paginated)
    // =========================================================================
    searchProducts(params) {
        const page = Math.max(1, params.page || 1);
        const limit = Math.max(1, Math.min(params.limit || 50, 200));
        const offset = (page - 1) * limit;
        const whereClauses = ['p.business_id = ?'];
        const sqlParams = [params.businessId];
        if (params.isActive !== undefined) {
            whereClauses.push('p.is_active = ?');
            sqlParams.push(params.isActive ? 1 : 0);
        }
        if (params.categoryId) {
            whereClauses.push('p.category_id = ?');
            sqlParams.push(params.categoryId);
        }
        if (params.brandId) {
            whereClauses.push('p.brand_id = ?');
            sqlParams.push(params.brandId);
        }
        if (params.productType) {
            whereClauses.push('p.product_type = ?');
            sqlParams.push(params.productType);
        }
        if (params.query && params.query.trim().length > 0) {
            const q = `%${params.query.trim()}%`;
            whereClauses.push(`(
        p.name LIKE ? OR
        p.sku LIKE ? OR
        p.barcode LIKE ? OR
        b.name LIKE ? OR
        c.name LIKE ? OR
        pd.model_number LIKE ?
      )`);
            sqlParams.push(q, q, q, q, q, q);
        }
        const whereSql = whereClauses.join(' AND ');
        // Total count for pagination
        const countSql = `
      SELECT COUNT(DISTINCT p.id) as total
      FROM products p
      LEFT JOIN product_details pd ON pd.product_id = p.id
      LEFT JOIN product_categories c ON c.id = p.category_id
      LEFT JOIN brands b ON b.id = p.brand_id
      WHERE ${whereSql}
    `;
        const total = this.db.prepare(countSql).get(...sqlParams).total;
        // Fetch page items
        const querySql = `
      SELECT p.id, p.business_id as businessId, p.sku, p.name, p.description,
             p.category_id as categoryId, c.name as categoryName,
             p.brand_id as brandId, b.name as brandName,
             p.product_type as productType, p.base_unit_id as baseUnitId, u.name as baseUnitName,
             p.default_sale_unit_id as defaultSaleUnitId, p.default_purchase_unit_id as defaultPurchaseUnitId,
             p.cost_method as costMethod, p.track_stock as trackStock, p.allow_negative_stock as allowNegativeStock,
             p.is_active as isActive, p.image_path as imagePath, p.created_at as createdAt, p.updated_at as updatedAt,
             p.barcode, p.cost_price as costPrice, p.selling_price as sellingPrice,
             p.current_stock as currentStock, p.min_stock_level as minStockLevel,
             p.tax_rate as taxRate, p.is_tax_inclusive as isTaxInclusive,
             pd.manufacturer, pd.model_number as modelNumber, pd.country_of_origin as countryOfOrigin,
             pd.warranty_months as warrantyMonths, pd.custom_attributes as customAttributesJson
      FROM products p
      LEFT JOIN product_details pd ON pd.product_id = p.id
      LEFT JOIN product_categories c ON c.id = p.category_id
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN units u ON u.id = p.base_unit_id
      WHERE ${whereSql}
      ORDER BY p.name ASC
      LIMIT ? OFFSET ?
    `;
        const rows = this.db.prepare(querySql).all(...sqlParams, limit, offset);
        const items = rows.map(r => ({
            id: r.id,
            businessId: r.businessId,
            sku: r.sku,
            name: r.name,
            description: r.description,
            categoryId: r.categoryId,
            categoryName: r.categoryName,
            brandId: r.brandId,
            brandName: r.brandName,
            productType: r.productType,
            baseUnitId: r.baseUnitId,
            baseUnitName: r.baseUnitName || 'Piece',
            defaultSaleUnitId: r.defaultSaleUnitId,
            defaultPurchaseUnitId: r.defaultPurchaseUnitId,
            costMethod: r.costMethod,
            trackStock: Boolean(r.trackStock),
            allowNegativeStock: Boolean(r.allowNegativeStock),
            isActive: Boolean(r.isActive),
            imagePath: r.imagePath,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            barcode: r.barcode,
            costPrice: r.costPrice,
            sellingPrice: r.sellingPrice,
            currentStock: r.currentStock,
            minStockLevel: r.minStockLevel,
            taxRate: r.taxRate,
            isTaxInclusive: Boolean(r.isTaxInclusive),
            details: r.manufacturer || r.modelNumber || r.countryOfOrigin || r.warrantyMonths || r.customAttributesJson
                ? {
                    productId: r.id,
                    manufacturer: r.manufacturer,
                    modelNumber: r.modelNumber,
                    countryOfOrigin: r.countryOfOrigin,
                    warrantyMonths: r.warrantyMonths,
                    customAttributes: r.customAttributesJson ? JSON.parse(r.customAttributesJson) : null
                }
                : null
        }));
        return {
            items,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        };
    }
    getProductById(businessId, id) {
        const row = this.db.prepare(`
      SELECT p.id, p.business_id as businessId, p.sku, p.name, p.description,
             p.category_id as categoryId, c.name as categoryName,
             p.brand_id as brandId, b.name as brandName,
             p.product_type as productType, p.base_unit_id as baseUnitId, u.name as baseUnitName,
             p.default_sale_unit_id as defaultSaleUnitId, p.default_purchase_unit_id as defaultPurchaseUnitId,
             p.cost_method as costMethod, p.track_stock as trackStock, p.allow_negative_stock as allowNegativeStock,
             p.is_active as isActive, p.image_path as imagePath, p.created_at as createdAt, p.updated_at as updatedAt,
             p.barcode, p.cost_price as costPrice, p.selling_price as sellingPrice,
             p.current_stock as currentStock, p.min_stock_level as minStockLevel,
             p.tax_rate as taxRate, p.is_tax_inclusive as isTaxInclusive,
             pd.manufacturer, pd.model_number as modelNumber, pd.country_of_origin as countryOfOrigin,
             pd.warranty_months as warrantyMonths, pd.custom_attributes as customAttributesJson
      FROM products p
      LEFT JOIN product_details pd ON pd.product_id = p.id
      LEFT JOIN product_categories c ON c.id = p.category_id
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN units u ON u.id = p.base_unit_id
      WHERE p.id = ? AND p.business_id = ?
    `).get(id, businessId);
        if (!row)
            return null;
        const prices = this.getProductPrices(businessId, id);
        return {
            id: row.id,
            businessId: row.businessId,
            sku: row.sku,
            name: row.name,
            description: row.description,
            categoryId: row.categoryId,
            categoryName: row.categoryName,
            brandId: row.brandId,
            brandName: row.brandName,
            productType: row.productType,
            baseUnitId: row.baseUnitId,
            baseUnitName: row.baseUnitName || 'Piece',
            defaultSaleUnitId: row.defaultSaleUnitId,
            defaultPurchaseUnitId: row.defaultPurchaseUnitId,
            costMethod: row.costMethod,
            trackStock: Boolean(row.trackStock),
            allowNegativeStock: Boolean(row.allowNegativeStock),
            isActive: Boolean(row.isActive),
            imagePath: row.imagePath,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            barcode: row.barcode,
            costPrice: row.costPrice,
            sellingPrice: row.sellingPrice,
            currentStock: row.currentStock,
            minStockLevel: row.minStockLevel,
            taxRate: row.taxRate,
            isTaxInclusive: Boolean(row.isTaxInclusive),
            details: row.manufacturer || row.modelNumber || row.countryOfOrigin || row.warrantyMonths || row.customAttributesJson
                ? {
                    productId: row.id,
                    manufacturer: row.manufacturer,
                    modelNumber: row.modelNumber,
                    countryOfOrigin: row.countryOfOrigin,
                    warrantyMonths: row.warrantyMonths,
                    customAttributes: row.customAttributesJson ? JSON.parse(row.customAttributesJson) : null
                }
                : null,
            prices
        };
    }
    // =========================================================================
    // 4. CATEGORIES (Nested & Cycle Prevention)
    // =========================================================================
    createCategory(dto) {
        if (dto.parentId) {
            const parent = this.db.prepare('SELECT id FROM product_categories WHERE id = ? AND business_id = ?').get(dto.parentId, dto.businessId);
            if (!parent) {
                throw new AppError_1.ValidationError(`Parent category not found with id "${dto.parentId}".`);
            }
        }
        const id = crypto_1.default.randomUUID();
        const isActive = dto.isActive !== false ? 1 : 0;
        this.db.prepare(`
      INSERT INTO product_categories (id, business_id, parent_id, name, code, is_active)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, dto.businessId, dto.parentId || null, dto.name, dto.code || null, isActive);
        return {
            id,
            businessId: dto.businessId,
            parentId: dto.parentId || null,
            name: dto.name,
            code: dto.code || null,
            isActive: isActive === 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }
    updateCategory(id, businessId, dto) {
        const existing = this.db.prepare('SELECT id, parent_id as parentId, name FROM product_categories WHERE id = ? AND business_id = ?').get(id, businessId);
        if (!existing) {
            throw new AppError_1.NotFoundError('Category', id);
        }
        // Validate cycle prevention
        if (dto.parentId !== undefined && dto.parentId !== existing.parentId) {
            (0, category_hierarchy_1.assertNoCategoryCycle)(id, dto.parentId, (targetId) => {
                const row = this.db.prepare('SELECT parent_id FROM product_categories WHERE id = ? AND business_id = ?').get(targetId, businessId);
                return row?.parent_id;
            });
        }
        this.db.prepare(`
      UPDATE product_categories
      SET name = COALESCE(?, name),
          code = CASE WHEN ? IS NOT NULL THEN ? ELSE code END,
          parent_id = CASE WHEN ? IS NOT NULL THEN ? ELSE parent_id END,
          is_active = CASE WHEN ? IS NOT NULL THEN ? ELSE is_active END,
          updated_at = (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
      WHERE id = ? AND business_id = ?
    `).run(dto.name ?? null, dto.code !== undefined ? dto.code : null, dto.code ?? null, dto.parentId !== undefined ? dto.parentId : null, dto.parentId ?? null, dto.isActive !== undefined ? (dto.isActive ? 1 : 0) : null, dto.isActive !== undefined ? (dto.isActive ? 1 : 0) : null, id, businessId);
        const updated = this.db.prepare('SELECT id, business_id as businessId, parent_id as parentId, name, code, is_active as isActive, created_at as createdAt, updated_at as updatedAt FROM product_categories WHERE id = ?').get(id);
        return {
            ...updated,
            isActive: Boolean(updated.isActive)
        };
    }
    listCategories(businessId) {
        const rows = this.db.prepare(`
      SELECT id, business_id as businessId, parent_id as parentId, name, code, is_active as isActive, created_at as createdAt, updated_at as updatedAt
      FROM product_categories
      WHERE business_id = ?
      ORDER BY name ASC
    `).all(businessId);
        return rows.map(r => ({
            ...r,
            isActive: Boolean(r.isActive)
        }));
    }
    // =========================================================================
    // 5. BRANDS
    // =========================================================================
    createBrand(dto) {
        const id = crypto_1.default.randomUUID();
        const isActive = dto.isActive !== false ? 1 : 0;
        this.db.prepare(`
      INSERT INTO brands (id, business_id, name, is_active)
      VALUES (?, ?, ?, ?)
    `).run(id, dto.businessId, dto.name, isActive);
        return {
            id,
            businessId: dto.businessId,
            name: dto.name,
            isActive: isActive === 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }
    listBrands(businessId) {
        const rows = this.db.prepare(`
      SELECT id, business_id as businessId, name, is_active as isActive, created_at as createdAt, updated_at as updatedAt
      FROM brands
      WHERE business_id = ?
      ORDER BY name ASC
    `).all(businessId);
        return rows.map(r => ({
            ...r,
            isActive: Boolean(r.isActive)
        }));
    }
}
exports.ProductCatalogService = ProductCatalogService;
