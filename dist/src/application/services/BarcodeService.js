"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BarcodeService = exports.BarcodeNotFoundError = exports.DuplicateBarcodeError = void 0;
const crypto_1 = require("crypto");
const scale_barcode_parser_1 = require("../../domain/barcodes/scale-barcode-parser");
class DuplicateBarcodeError extends Error {
    constructor(message) {
        super(message);
        this.name = 'DuplicateBarcodeError';
    }
}
exports.DuplicateBarcodeError = DuplicateBarcodeError;
class BarcodeNotFoundError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BarcodeNotFoundError';
    }
}
exports.BarcodeNotFoundError = BarcodeNotFoundError;
class BarcodeService {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * Central Barcode Workflow Lookup:
     * 1. Normalizes input (trims whitespace, control chars).
     * 2. Searches active product_barcodes matches.
     * 3. Checks direct product barcode/SKU matches.
     * 4. Checks active scale_barcode_profiles for weighted barcodes.
     * 5. Resolves packaging unit conversions where linked.
     */
    lookupBarcode(businessId, barcodeInput) {
        const cleaned = (barcodeInput || '').trim().replace(/[\r\n\t]/g, '');
        if (!cleaned) {
            return {
                status: 'NOT_FOUND',
                barcodeValue: barcodeInput,
                message: 'Empty barcode input provided.'
            };
        }
        // 1. Search in product_barcodes for active match
        const barcodeRow = this.db.prepare(`
      SELECT pb.id, pb.business_id, pb.product_id, pb.product_unit_conversion_id,
             pb.barcode_value, pb.barcode_type, pb.is_primary, pb.is_active,
             p.name as product_name, p.sku, p.base_unit_id, p.product_type,
             p.cost_price, p.selling_price, p.default_sale_price_minor,
             p.is_active as product_is_active, p.track_stock,
             u.name as base_unit_name,
             puc.to_base_factor_numerator, puc.to_base_factor_denominator,
             puc.from_unit_id,
             pu.name as packaging_unit_name
      FROM product_barcodes pb
      JOIN products p ON pb.product_id = p.id
      LEFT JOIN units u ON p.base_unit_id = u.id
      LEFT JOIN product_unit_conversions puc ON pb.product_unit_conversion_id = puc.id
      LEFT JOIN units pu ON puc.from_unit_id = pu.id
      WHERE pb.business_id = ? AND pb.barcode_value = ? AND pb.is_active = 1
    `).get(businessId, cleaned);
        if (barcodeRow) {
            if (!barcodeRow.product_is_active) {
                return {
                    status: 'NOT_FOUND',
                    barcodeValue: cleaned,
                    message: `Product "${barcodeRow.product_name}" is archived/inactive and cannot be sold.`
                };
            }
            // Check if this barcode identifies a packaging unit
            let unitId = barcodeRow.base_unit_id;
            let unitName = barcodeRow.base_unit_name || 'Piece';
            let unitPriceMinor = barcodeRow.default_sale_price_minor || barcodeRow.selling_price || 0;
            let packagingUnit = null;
            if (barcodeRow.product_unit_conversion_id && barcodeRow.from_unit_id) {
                unitId = barcodeRow.from_unit_id;
                unitName = barcodeRow.packaging_unit_name || 'Pack';
                packagingUnit = {
                    id: barcodeRow.product_unit_conversion_id,
                    fromUnitId: barcodeRow.from_unit_id,
                    numerator: Number(barcodeRow.to_base_factor_numerator || 1),
                    denominator: Number(barcodeRow.to_base_factor_denominator || 1)
                };
                // Multiplied price for packaging unit (e.g. pack of 6)
                unitPriceMinor = Math.round((unitPriceMinor * packagingUnit.numerator) / packagingUnit.denominator);
            }
            return {
                status: 'FOUND',
                barcodeValue: cleaned,
                product: {
                    id: barcodeRow.product_id,
                    businessId: barcodeRow.business_id,
                    name: barcodeRow.product_name,
                    sku: barcodeRow.sku,
                    productType: barcodeRow.product_type,
                    baseUnitId: barcodeRow.base_unit_id,
                    baseUnitName: barcodeRow.base_unit_name,
                    sellingPriceMinor: barcodeRow.default_sale_price_minor || barcodeRow.selling_price
                },
                packagingUnit,
                unitId,
                unitName,
                unitPriceMinor
            };
        }
        // 2. Direct fallback on products table (sku or primary barcode)
        const directProduct = this.db.prepare(`
      SELECT p.id, p.business_id, p.name, p.sku, p.base_unit_id, p.product_type,
             p.selling_price, p.default_sale_price_minor, p.is_active,
             u.name as base_unit_name
      FROM products p
      LEFT JOIN units u ON p.base_unit_id = u.id
      WHERE p.business_id = ? AND (p.barcode = ? OR p.sku = ?) AND p.is_active = 1
    `).get(businessId, cleaned, cleaned);
        if (directProduct) {
            return {
                status: 'FOUND',
                barcodeValue: cleaned,
                product: {
                    id: directProduct.id,
                    businessId: directProduct.business_id,
                    name: directProduct.name,
                    sku: directProduct.sku,
                    productType: directProduct.product_type,
                    baseUnitId: directProduct.base_unit_id,
                    baseUnitName: directProduct.base_unit_name,
                    sellingPriceMinor: directProduct.default_sale_price_minor || directProduct.selling_price
                },
                unitId: directProduct.base_unit_id,
                unitName: directProduct.base_unit_name || 'Piece',
                unitPriceMinor: directProduct.default_sale_price_minor || directProduct.selling_price
            };
        }
        // 3. Search scale barcode profiles for dynamic barcode parsing
        const profiles = this.listScaleProfiles(businessId);
        for (const profile of profiles) {
            if (cleaned.startsWith(profile.prefix) && cleaned.length === profile.totalLength) {
                try {
                    const parsedScale = (0, scale_barcode_parser_1.parseScaleBarcode)(cleaned, profile);
                    // Find product by parsed product code (matched against SKU, barcode column, or product_barcodes entry)
                    const scaleProd = this.db.prepare(`
            SELECT p.id, p.business_id, p.name, p.sku, p.base_unit_id, p.product_type,
                   p.selling_price, p.default_sale_price_minor, p.is_active,
                   u.name as base_unit_name
            FROM products p
            LEFT JOIN units u ON p.base_unit_id = u.id
            WHERE p.business_id = ? AND p.is_active = 1 AND (
              p.sku = ? OR p.barcode = ? OR EXISTS (
                SELECT 1 FROM product_barcodes pb
                WHERE pb.product_id = p.id AND pb.barcode_value = ? AND pb.is_active = 1
              )
            )
          `).get(businessId, parsedScale.productCode, parsedScale.productCode, parsedScale.productCode);
                    if (scaleProd) {
                        const basePriceMinor = scaleProd.default_sale_price_minor || scaleProd.selling_price || 0;
                        let linePriceMinor;
                        let parsedWeight;
                        let parsedPriceMinor;
                        if (parsedScale.valueType === 'weight') {
                            parsedWeight = parsedScale.parsedValue; // e.g. 1.250 kg
                            linePriceMinor = Math.round(parsedWeight * basePriceMinor);
                        }
                        else {
                            parsedPriceMinor = Math.round(parsedScale.parsedValue * 100); // Currency minor units
                            linePriceMinor = parsedPriceMinor;
                            parsedWeight = basePriceMinor > 0 ? parsedPriceMinor / basePriceMinor : 0;
                        }
                        return {
                            status: 'SCALE_BARCODE',
                            barcodeValue: cleaned,
                            product: {
                                id: scaleProd.id,
                                businessId: scaleProd.business_id,
                                name: scaleProd.name,
                                sku: scaleProd.sku,
                                productType: scaleProd.product_type,
                                baseUnitId: scaleProd.base_unit_id,
                                baseUnitName: scaleProd.base_unit_name,
                                sellingPriceMinor: basePriceMinor
                            },
                            unitId: scaleProd.base_unit_id,
                            unitName: scaleProd.base_unit_name || 'Kilogram',
                            unitPriceMinor: basePriceMinor,
                            parsedWeight,
                            parsedPriceMinor,
                            linePriceMinor
                        };
                    }
                }
                catch {
                    // If parse fails for this specific profile, continue checking others
                }
            }
        }
        return {
            status: 'NOT_FOUND',
            barcodeValue: cleaned,
            message: `No active product found for barcode "${cleaned}".`
        };
    }
    /**
     * Add a new barcode to a product or packaging unit.
     * Enforces business-wide uniqueness across active barcodes.
     */
    addBarcode(dto, actor) {
        const val = (dto.barcodeValue || '').trim();
        if (!val) {
            throw new Error('Barcode value cannot be empty.');
        }
        const businessId = dto.businessId || actor.businessId || '00000000-0000-0000-0000-000000000001';
        // Check duplicate active barcode in this business
        const existing = this.db.prepare(`
      SELECT pb.id, pb.product_id, p.name as product_name
      FROM product_barcodes pb
      JOIN products p ON pb.product_id = p.id
      WHERE pb.business_id = ? AND pb.barcode_value = ? AND pb.is_active = 1
    `).get(businessId, val);
        if (existing) {
            throw new DuplicateBarcodeError(`Barcode "${val}" is already assigned to active product "${existing.product_name}". Duplicate active barcodes are prohibited.`);
        }
        const id = (0, crypto_1.randomUUID)();
        const isPrimary = dto.isPrimary ? 1 : 0;
        const isActive = dto.isActive !== undefined ? (dto.isActive ? 1 : 0) : 1;
        const barcodeType = dto.barcodeType || 'EAN13';
        // If setting as primary, unset previous primary barcodes for this product
        if (isPrimary) {
            this.db.prepare(`
        UPDATE product_barcodes
        SET is_primary = 0
        WHERE business_id = ? AND product_id = ?
      `).run(businessId, dto.productId);
        }
        this.db.prepare(`
      INSERT INTO product_barcodes (
        id, business_id, product_id, product_unit_conversion_id,
        barcode_value, barcode_type, is_primary, is_active,
        barcode, unit_id, created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, businessId, dto.productId, dto.productUnitConversionId || null, val, barcodeType, isPrimary, isActive, val, dto.unitId || null, actor.userId ? String(actor.userId) : null);
        return {
            id,
            businessId,
            productId: dto.productId,
            productUnitConversionId: dto.productUnitConversionId || null,
            barcodeValue: val,
            barcodeType,
            isPrimary: Boolean(isPrimary),
            isActive: Boolean(isActive),
            unitId: dto.unitId
        };
    }
    /**
     * Set primary barcode for a product
     */
    setPrimaryBarcode(businessId, productId, barcodeId) {
        const tx = this.db.transaction(() => {
            this.db.prepare(`
        UPDATE product_barcodes
        SET is_primary = 0
        WHERE business_id = ? AND product_id = ?
      `).run(businessId, productId);
            this.db.prepare(`
        UPDATE product_barcodes
        SET is_primary = 1
        WHERE business_id = ? AND product_id = ? AND id = ?
      `).run(businessId, productId, barcodeId);
        });
        tx();
    }
    /**
     * Deactivate a barcode
     */
    deactivateBarcode(businessId, barcodeId) {
        this.db.prepare(`
      UPDATE product_barcodes
      SET is_active = 0
      WHERE business_id = ? AND id = ?
    `).run(businessId, barcodeId);
    }
    /**
     * List barcodes for a product
     */
    listProductBarcodes(productId) {
        const rows = this.db.prepare(`
      SELECT pb.id, pb.business_id, pb.product_id, pb.product_unit_conversion_id,
             pb.barcode_value, pb.barcode_type, pb.is_primary, pb.is_active,
             pb.created_at, pb.created_by,
             puc.from_unit_id as unit_id,
             u.name as unit_name,
             puc.to_base_factor_numerator as conversion_numerator,
             puc.to_base_factor_denominator as conversion_denominator
      FROM product_barcodes pb
      LEFT JOIN product_unit_conversions puc ON pb.product_unit_conversion_id = puc.id
      LEFT JOIN units u ON puc.from_unit_id = u.id
      WHERE pb.product_id = ?
      ORDER BY pb.is_primary DESC, pb.created_at DESC
    `).all(productId);
        return rows.map((r) => ({
            id: r.id,
            businessId: r.business_id,
            productId: r.product_id,
            productUnitConversionId: r.product_unit_conversion_id,
            barcodeValue: r.barcode_value,
            barcodeType: r.barcode_type,
            isPrimary: Boolean(r.is_primary),
            isActive: Boolean(r.is_active),
            createdAt: r.created_at,
            createdBy: r.created_by,
            unitId: r.unit_id,
            unitName: r.unit_name,
            conversionNumerator: r.conversion_numerator ? Number(r.conversion_numerator) : undefined,
            conversionDenominator: r.conversion_denominator ? Number(r.conversion_denominator) : undefined
        }));
    }
    // -------------------------------------------------------------------------
    // SCALE BARCODE PROFILES
    // -------------------------------------------------------------------------
    createScaleProfile(dto, actor) {
        if (!dto.name || !dto.name.trim()) {
            throw new Error('Profile name is required.');
        }
        if (!dto.prefix || !dto.prefix.trim()) {
            throw new Error('Prefix is required.');
        }
        if (dto.totalLength <= 0) {
            throw new Error('Total length must be greater than zero.');
        }
        const businessId = dto.businessId || actor.businessId || '00000000-0000-0000-0000-000000000001';
        const id = (0, crypto_1.randomUUID)();
        this.db.prepare(`
      INSERT INTO scale_barcode_profiles (
        id, business_id, name, prefix, total_length,
        product_code_start, product_code_length,
        value_start, value_length, value_type, decimal_places,
        check_digit_rule, is_active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, businessId, dto.name.trim(), dto.prefix.trim(), dto.totalLength, dto.productCodeStart, dto.productCodeLength, dto.valueStart, dto.valueLength, dto.valueType, dto.decimalPlaces !== undefined ? dto.decimalPlaces : 3, dto.checkDigitRule || null, dto.isActive !== undefined ? (dto.isActive ? 1 : 0) : 1);
        return {
            id,
            businessId,
            name: dto.name.trim(),
            prefix: dto.prefix.trim(),
            totalLength: dto.totalLength,
            productCodeStart: dto.productCodeStart,
            productCodeLength: dto.productCodeLength,
            valueStart: dto.valueStart,
            valueLength: dto.valueLength,
            valueType: dto.valueType,
            decimalPlaces: dto.decimalPlaces !== undefined ? dto.decimalPlaces : 3,
            checkDigitRule: dto.checkDigitRule,
            isActive: dto.isActive !== undefined ? Boolean(dto.isActive) : true
        };
    }
    listScaleProfiles(businessId) {
        const rows = this.db.prepare(`
      SELECT id, business_id, name, prefix, total_length,
             product_code_start, product_code_length,
             value_start, value_length, value_type, decimal_places,
             check_digit_rule, is_active, created_at, updated_at
      FROM scale_barcode_profiles
      WHERE business_id = ? AND is_active = 1
      ORDER BY prefix DESC
    `).all(businessId);
        return rows.map((r) => ({
            id: r.id,
            businessId: r.business_id,
            name: r.name,
            prefix: r.prefix,
            totalLength: r.total_length,
            productCodeStart: r.product_code_start,
            productCodeLength: r.product_code_length,
            valueStart: r.value_start,
            valueLength: r.value_length,
            valueType: r.value_type,
            decimalPlaces: r.decimal_places,
            checkDigitRule: r.check_digit_rule,
            isActive: Boolean(r.is_active),
            createdAt: r.created_at,
            updatedAt: r.updated_at
        }));
    }
    testScaleBarcodeDiagnostic(barcode, profileIdOrProfile) {
        let profile;
        if (typeof profileIdOrProfile === 'string') {
            const row = this.db.prepare(`
        SELECT id, business_id, name, prefix, total_length,
               product_code_start, product_code_length,
               value_start, value_length, value_type, decimal_places,
               check_digit_rule, is_active
        FROM scale_barcode_profiles
        WHERE id = ?
      `).get(profileIdOrProfile);
            if (!row) {
                throw new Error(`Scale barcode profile "${profileIdOrProfile}" not found.`);
            }
            profile = {
                id: row.id,
                businessId: row.business_id,
                name: row.name,
                prefix: row.prefix,
                totalLength: row.total_length,
                productCodeStart: row.product_code_start,
                productCodeLength: row.product_code_length,
                valueStart: row.value_start,
                valueLength: row.value_length,
                valueType: row.value_type,
                decimalPlaces: row.decimal_places,
                checkDigitRule: row.check_digit_rule,
                isActive: Boolean(row.is_active)
            };
        }
        else {
            profile = profileIdOrProfile;
        }
        return (0, scale_barcode_parser_1.testScaleBarcode)(barcode, profile);
    }
}
exports.BarcodeService = BarcodeService;
