"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SerialTrackingService = void 0;
const connection_1 = require("../../infrastructure/sqlite/connection");
const SerialRepository_1 = require("../../infrastructure/sqlite/repositories/SerialRepository");
const StockBalanceRepository_1 = require("../../infrastructure/sqlite/repositories/StockBalanceRepository");
const ProductRepository_1 = require("../../infrastructure/sqlite/repositories/ProductRepository");
const StockLocationRepository_1 = require("../../infrastructure/sqlite/repositories/StockLocationRepository");
const accounts_1 = require("../../shared/constants/accounts");
const roles_permissions_1 = require("../../shared/constants/roles-permissions");
const serial_rules_1 = require("../../domain/inventory/serial-rules");
const serial_math_1 = require("../../domain/inventory/serial-math");
class SerialTrackingService {
    db;
    serialRepo;
    balanceRepo;
    productRepo;
    locationRepo;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
        this.serialRepo = new SerialRepository_1.SerialRepository(this.db);
        this.balanceRepo = new StockBalanceRepository_1.StockBalanceRepository(this.db);
        this.productRepo = new ProductRepository_1.ProductRepository(this.db);
        this.locationRepo = new StockLocationRepository_1.StockLocationRepository(this.db);
    }
    // =========================================================================
    // 1. SETTINGS CONFIGURATION
    // =========================================================================
    configureSettings(input) {
        const product = this.productRepo.findById(input.productId);
        if (!product) {
            throw new Error(`Product '${input.productId}' not found.`);
        }
        return this.serialRepo.upsertSettings(input);
    }
    getSettings(businessId, productId) {
        return this.serialRepo.getSettings(productId, businessId);
    }
    // =========================================================================
    // 2. PURCHASE RECEIVING
    // =========================================================================
    receiveSerialUnits(input) {
        const product = this.productRepo.findById(input.productId);
        if (!product) {
            throw new Error(`Product '${input.productId}' not found.`);
        }
        if (!product.isActive) {
            throw new Error(`Cannot receive inventory for archived product '${product.name}'.`);
        }
        const settings = this.serialRepo.getSettings(product.id, input.businessId);
        // Validate payload against domain rules (count match, internal duplicates, format, manual entry)
        serial_rules_1.SerialRules.validateReceiving(product.name, input.quantityScaled, input.serials, settings);
        // Validate duplicates against existing database records
        for (const item of input.serials) {
            const cleanSn = item.serialNumber.trim();
            const existingSn = this.serialRepo.findBySerialNumberAnyProduct(input.businessId, cleanSn);
            if (existingSn) {
                throw new serial_rules_1.DuplicateSerialNumberError(cleanSn, `already registered under product '${existingSn.productId}' with status '${existingSn.status}'`);
            }
            if (item.imei1) {
                const existingImei = this.serialRepo.findByImei(input.businessId, item.imei1);
                if (existingImei) {
                    throw new serial_rules_1.DuplicateImeiError(item.imei1);
                }
            }
            if (item.imei2) {
                const existingImei2 = this.serialRepo.findByImei(input.businessId, item.imei2);
                if (existingImei2) {
                    throw new serial_rules_1.DuplicateImeiError(item.imei2);
                }
            }
        }
        const unitCost = input.unitCostMinor != null
            ? input.unitCostMinor
            : (product.defaultCostMinor || product.costPrice || 0);
        const receivedCount = input.serials.length;
        let createdSerials = [];
        const tx = this.db.transaction(() => {
            const now = new Date().toISOString();
            // 1. Insert serial records
            createdSerials = this.serialRepo.createBatch(input.serials.map((s) => ({
                businessId: input.businessId,
                productId: String(product.id),
                serialNumber: s.serialNumber.trim(),
                manufacturerSerial: s.manufacturerSerial?.trim() || null,
                imei1: s.imei1?.trim() || null,
                imei2: s.imei2?.trim() || null,
                purchaseDocumentLineId: input.purchaseDocumentLineId || null,
                supplierId: input.supplierId || null,
                currentLocationId: input.stockLocationId,
                status: 'in_stock',
                unitCostMinor: unitCost,
                receivedAt: now,
                soldAt: null
            })));
            // 2. Log history event for each serial
            for (const serial of createdSerials) {
                this.serialRepo.logHistory({
                    businessId: input.businessId,
                    serialNumberId: serial.id,
                    eventType: 'PURCHASE_RECEIPT',
                    referenceType: 'purchase_order',
                    referenceId: input.purchaseDocumentLineId || undefined,
                    toLocationId: input.stockLocationId,
                    toStatus: 'in_stock',
                    notes: input.notes || `Received from supplier ${input.supplierId || 'N/A'} at unit cost ${unitCost}`,
                    performedBy: input.userId
                });
                // 3. If warranty start trigger is on_purchase and warranty months configured, create initial warranty
                if (settings?.warrantyDefaultMonths && settings.warrantyStartTrigger === 'on_purchase') {
                    const startDate = now.substring(0, 10);
                    const endDate = (0, serial_math_1.calculateWarrantyEndDate)(startDate, settings.warrantyDefaultMonths);
                    this.serialRepo.createWarranty({
                        businessId: input.businessId,
                        serialNumberId: serial.id,
                        warrantyStartDate: startDate,
                        warrantyEndDate: endDate,
                        warrantyProvider: 'Supplier / Manufacturer',
                        warrantyReference: input.purchaseDocumentLineId || undefined,
                        warrantyTerms: `${settings.warrantyDefaultMonths} months manufacturer warranty starting on purchase`,
                        warrantyTrigger: 'on_purchase'
                    });
                }
            }
            // 4. Update stock location balance
            this.balanceRepo.upsertDelta({
                businessId: input.businessId,
                productId: product.id,
                stockLocationId: input.stockLocationId,
                onHandDeltaScaled: input.quantityScaled
            });
            // 5. Update product general stock
            const baseQty = input.quantityScaled / 1000;
            this.productRepo.updateStock(product.id, product.currentStock + baseQty);
            // 6. Log stock movement
            this.productRepo.logStockMovement({
                productId: product.id,
                movementType: accounts_1.StockMovementType.PURCHASE_RECEIPT,
                quantity: baseQty,
                previousStock: product.currentStock,
                newStock: product.currentStock + baseQty,
                stockLocationId: input.stockLocationId,
                referenceType: 'PURCHASE_RECEIPT',
                reason: `Purchase receipt of ${receivedCount} serial-tracked unit(s)`,
                userId: input.userId ? Number(input.userId) : 1
            });
        });
        tx();
        return {
            receivedSerials: createdSerials,
            totalCount: createdSerials.length
        };
    }
    // =========================================================================
    // 3. SALE ALLOCATION & CLAIMS
    // =========================================================================
    validateAndAllocateSaleSerials(input) {
        const product = this.productRepo.findById(input.productId);
        if (!product) {
            throw new Error(`Product '${input.productId}' not found.`);
        }
        const expectedCount = Math.round(input.quantityScaled / 1000);
        const resolvedSerials = [];
        if (input.serials && input.serials.length > 0) {
            // Caller explicitly specified serial numbers or IDs
            if (input.serials.length !== expectedCount) {
                throw new serial_rules_1.SerialCountMismatchError(product.name, expectedCount, input.serials.length);
            }
            for (const identifier of input.serials) {
                let serial = this.serialRepo.findById(identifier);
                if (!serial) {
                    serial = this.serialRepo.findBySerialNumber(input.businessId, product.id, identifier);
                }
                if (!serial) {
                    throw new serial_rules_1.SerialNotFoundError(identifier);
                }
                serial_rules_1.SerialRules.validateSaleSerialEligibility(serial, String(product.id), input.stockLocationId);
                resolvedSerials.push(serial);
            }
        }
        else {
            // Auto-allocate available serials at this location (FIFO)
            const available = this.serialRepo.findAvailableAtLocation(input.businessId, product.id, input.stockLocationId);
            if (available.length < expectedCount) {
                throw new serial_rules_1.SerialNotAvailableError(`${expectedCount} serials requested for '${product.name}'`, `Only ${available.length} available at this location`);
            }
            for (let i = 0; i < expectedCount; i++) {
                resolvedSerials.push(available[i]);
            }
        }
        return resolvedSerials;
    }
    /**
     * Concurrency Safe: Atomically transitions serial status to sold, creates warranty, and records audit history
     */
    claimSaleSerials(serials, saleId, saleItemId, businessId, cashierId) {
        const results = [];
        const now = new Date().toISOString();
        const todayDate = now.substring(0, 10);
        for (const serial of serials) {
            // 1. Atomic update to prevent multi-counter race condition
            const claimed = this.serialRepo.atomicSellSerial(serial.id, now);
            if (!claimed) {
                throw new serial_rules_1.SerialAlreadySoldError(serial.serialNumber);
            }
            // 2. Fetch settings to determine warranty policy
            const settings = this.serialRepo.getSettings(serial.productId, businessId);
            let warrantyId = null;
            if (settings?.warrantyDefaultMonths && settings.warrantyDefaultMonths > 0) {
                const endDate = (0, serial_math_1.calculateWarrantyEndDate)(todayDate, settings.warrantyDefaultMonths);
                const warranty = this.serialRepo.createWarranty({
                    businessId,
                    serialNumberId: serial.id,
                    warrantyStartDate: todayDate,
                    warrantyEndDate: endDate,
                    warrantyProvider: 'Retail Store Warranty',
                    warrantyReference: `Sale #${saleId}`,
                    warrantyTerms: `${settings.warrantyDefaultMonths} months warranty from sale date`,
                    warrantyTrigger: 'on_sale'
                });
                warrantyId = warranty.id;
                // Log warranty event
                this.serialRepo.logHistory({
                    businessId,
                    serialNumberId: serial.id,
                    eventType: 'WARRANTY_REGISTRATION',
                    referenceType: 'sale',
                    referenceId: String(saleId),
                    notes: `Registered ${settings.warrantyDefaultMonths} months warranty until ${endDate}`,
                    performedBy: cashierId
                });
            }
            // 3. Log sale history
            this.serialRepo.logHistory({
                businessId,
                serialNumberId: serial.id,
                eventType: 'SALE',
                referenceType: 'sale',
                referenceId: String(saleId),
                fromStatus: 'in_stock',
                toStatus: 'sold',
                notes: `Sold on invoice #${saleId}`,
                performedBy: cashierId
            });
            // 4. Save sale item serial
            const sis = this.serialRepo.createSaleItemSerial({
                businessId,
                saleId: String(saleId),
                saleItemId: String(saleItemId),
                productId: serial.productId,
                serialNumberId: serial.id,
                unitCostMinor: serial.unitCostMinor,
                warrantyId
            });
            results.push(sis);
        }
        return results;
    }
    // =========================================================================
    // 4. RETURNS, WARRANTY & REPAIRS
    // =========================================================================
    processCustomerReturn(input) {
        const serial = this.serialRepo.findBySerialNumberAnyProduct(input.businessId, input.serialNumber);
        if (!serial) {
            throw new serial_rules_1.SerialNotFoundError(input.serialNumber);
        }
        // Determine target status according to return condition & authorization
        const targetStatus = serial_rules_1.SerialRules.validateCustomerReturn(serial, input.condition, input.hasOriginalReceipt, Boolean(input.managerApproved));
        const destLocationId = input.destinationLocationId || serial.currentLocationId;
        const now = new Date().toISOString();
        const tx = this.db.transaction(() => {
            // 1. Update status and location
            this.serialRepo.updateStatus(serial.id, targetStatus);
            if (destLocationId && destLocationId !== serial.currentLocationId) {
                this.serialRepo.updateLocation(serial.id, destLocationId);
            }
            // 2. Log history
            const hist = this.serialRepo.logHistory({
                businessId: input.businessId,
                serialNumberId: serial.id,
                eventType: 'SALE_RETURN',
                referenceType: input.saleId ? 'sale' : 'return',
                referenceId: input.saleId || input.receiptNumber,
                fromStatus: serial.status,
                toStatus: targetStatus,
                fromLocationId: serial.currentLocationId,
                toLocationId: destLocationId,
                notes: `Customer return (${input.condition}): ${input.reason}${!input.hasOriginalReceipt ? ` [Manager approved by ${input.managerApprovedBy || 'Admin'}]` : ''}`,
                performedBy: input.userId
            });
            // 3. If returned into in_stock, update stock balance and movement
            if (targetStatus === 'in_stock' && destLocationId) {
                this.balanceRepo.upsertDelta({
                    businessId: input.businessId,
                    productId: serial.productId,
                    stockLocationId: destLocationId,
                    onHandDeltaScaled: 1000
                });
                const product = this.productRepo.findById(serial.productId);
                if (product) {
                    this.productRepo.updateStock(product.id, product.currentStock + 1);
                    this.productRepo.logStockMovement({
                        productId: product.id,
                        movementType: accounts_1.StockMovementType.SALE_RETURN,
                        quantity: 1,
                        previousStock: product.currentStock,
                        newStock: product.currentStock + 1,
                        stockLocationId: destLocationId,
                        referenceType: 'SALE_RETURN',
                        reason: `Return of serial ${serial.serialNumber}`,
                        userId: input.userId ? Number(input.userId) : 1
                    });
                }
            }
            return {
                serial: this.serialRepo.findById(serial.id),
                newStatus: targetStatus,
                history: hist
            };
        });
        return tx();
    }
    createWarrantyClaim(input) {
        const serial = this.serialRepo.findBySerialNumberAnyProduct(input.businessId, input.serialNumber);
        if (!serial) {
            throw new serial_rules_1.SerialNotFoundError(input.serialNumber);
        }
        const warranty = this.serialRepo.getWarrantyForSerial(serial.id);
        const today = new Date().toISOString().substring(0, 10);
        if (warranty && warranty.warrantyEndDate) {
            const active = (0, serial_math_1.isWarrantyActive)(warranty.warrantyStartDate, warranty.warrantyEndDate, today);
            if (!active) {
                throw new serial_rules_1.WarrantyExpiredError(serial.serialNumber, warranty.warrantyEndDate);
            }
        }
        const targetStatus = 'under_repair';
        const tx = this.db.transaction(() => {
            this.serialRepo.updateStatus(serial.id, targetStatus);
            const claimEvent = this.serialRepo.logHistory({
                businessId: input.businessId,
                serialNumberId: serial.id,
                eventType: 'WARRANTY_CLAIM',
                referenceType: 'warranty',
                referenceId: warranty ? warranty.id : undefined,
                fromStatus: serial.status,
                toStatus: targetStatus,
                notes: `Warranty claim [${input.claimType}]: ${input.issueDescription}`,
                performedBy: input.userId
            });
            return {
                claimEvent,
                warranty,
                status: targetStatus
            };
        });
        return tx();
    }
    replaceDefectiveSerial(input) {
        const defective = this.serialRepo.findBySerialNumberAnyProduct(input.businessId, input.defectiveSerialNumber);
        if (!defective) {
            throw new serial_rules_1.SerialNotFoundError(input.defectiveSerialNumber);
        }
        const replacement = this.serialRepo.findBySerialNumberAnyProduct(input.businessId, input.replacementSerialNumber);
        if (!replacement) {
            throw new serial_rules_1.SerialNotFoundError(input.replacementSerialNumber);
        }
        if (replacement.status !== 'in_stock') {
            throw new serial_rules_1.SerialNotAvailableError(replacement.serialNumber, replacement.status);
        }
        if (String(defective.productId) !== String(replacement.productId)) {
            throw new Error('Replacement unit must be the same product model as the defective unit.');
        }
        const tx = this.db.transaction(() => {
            const now = new Date().toISOString();
            // 1. Mark replacement as sold
            this.serialRepo.updateStatus(replacement.id, 'sold', now);
            // 2. Mark defective as under_repair or quarantined
            this.serialRepo.updateStatus(defective.id, 'quarantined');
            // 3. Transfer/Extend warranty to replacement unit
            const oldWarranty = this.serialRepo.getWarrantyForSerial(defective.id);
            if (oldWarranty) {
                this.serialRepo.createWarranty({
                    businessId: input.businessId,
                    serialNumberId: replacement.id,
                    warrantyStartDate: oldWarranty.warrantyStartDate,
                    warrantyEndDate: oldWarranty.warrantyEndDate,
                    warrantyProvider: oldWarranty.warrantyProvider,
                    warrantyReference: `Replacement for ${defective.serialNumber}`,
                    warrantyTerms: `Transferred remaining warranty from defective unit ${defective.serialNumber}`,
                    warrantyTrigger: oldWarranty.warrantyTrigger
                });
            }
            // 4. Record history events for both
            this.serialRepo.logHistory({
                businessId: input.businessId,
                serialNumberId: defective.id,
                eventType: 'REPLACEMENT_SWAP',
                fromStatus: defective.status,
                toStatus: 'quarantined',
                notes: `Defective unit swapped out for replacement unit '${replacement.serialNumber}'. Reason: ${input.reason}`,
                performedBy: input.userId
            });
            this.serialRepo.logHistory({
                businessId: input.businessId,
                serialNumberId: replacement.id,
                eventType: 'REPLACEMENT_SWAP',
                fromStatus: 'in_stock',
                toStatus: 'sold',
                notes: `Issued as replacement unit for defective unit '${defective.serialNumber}'. Reason: ${input.reason}`,
                performedBy: input.userId
            });
            // 5. Decrement replacement stock from location
            if (replacement.currentLocationId) {
                this.balanceRepo.upsertDelta({
                    businessId: input.businessId,
                    productId: replacement.productId,
                    stockLocationId: replacement.currentLocationId,
                    onHandDeltaScaled: -1000
                });
            }
            return {
                defectiveSerial: this.serialRepo.findById(defective.id),
                replacementSerial: this.serialRepo.findById(replacement.id)
            };
        });
        return tx();
    }
    // =========================================================================
    // 5. INTER-LOCATION TRANSFERS & STATUS CHANGES
    // =========================================================================
    transferSerial(input) {
        const serial = this.serialRepo.findBySerialNumberAnyProduct(input.businessId, input.serialNumber);
        if (!serial) {
            throw new serial_rules_1.SerialNotFoundError(input.serialNumber);
        }
        if (serial.status === 'sold' || serial.status === 'written_off') {
            throw new Error(`Cannot transfer serial '${serial.serialNumber}' with status '${serial.status}'.`);
        }
        if (serial.currentLocationId && serial.currentLocationId !== input.fromLocationId) {
            throw new Error(`Serial '${serial.serialNumber}' is currently at location '${serial.currentLocationId}', not '${input.fromLocationId}'.`);
        }
        const tx = this.db.transaction(() => {
            // 1. Update serial location
            this.serialRepo.updateLocation(serial.id, input.toLocationId);
            // 2. Log history event
            const hist = this.serialRepo.logHistory({
                businessId: input.businessId,
                serialNumberId: serial.id,
                eventType: 'TRANSFER',
                fromLocationId: input.fromLocationId,
                toLocationId: input.toLocationId,
                notes: input.reason || `Transferred from ${input.fromLocationId} to ${input.toLocationId}`,
                performedBy: input.userId
            });
            // 3. Update stock balances if in_stock
            if (serial.status === 'in_stock') {
                this.balanceRepo.upsertDelta({
                    businessId: input.businessId,
                    productId: serial.productId,
                    stockLocationId: input.fromLocationId,
                    onHandDeltaScaled: -1000
                });
                this.balanceRepo.upsertDelta({
                    businessId: input.businessId,
                    productId: serial.productId,
                    stockLocationId: input.toLocationId,
                    onHandDeltaScaled: 1000
                });
            }
            return {
                serial: this.serialRepo.findById(serial.id),
                history: hist
            };
        });
        return tx();
    }
    updateSerialStatus(input) {
        const serial = this.serialRepo.findBySerialNumberAnyProduct(input.businessId, input.serialNumber);
        if (!serial) {
            throw new serial_rules_1.SerialNotFoundError(input.serialNumber);
        }
        serial_rules_1.SerialRules.validateStatusTransition(serial.serialNumber, serial.status, input.targetStatus);
        const tx = this.db.transaction(() => {
            this.serialRepo.updateStatus(serial.id, input.targetStatus);
            if (input.destinationLocationId) {
                this.serialRepo.updateLocation(serial.id, input.destinationLocationId);
            }
            let eventType = 'STATUS_CHANGE';
            if (input.targetStatus === 'quarantined')
                eventType = 'QUARANTINE';
            if (input.targetStatus === 'in_stock' && serial.status === 'quarantined')
                eventType = 'RELEASE_QUARANTINE';
            if (input.targetStatus === 'written_off')
                eventType = 'WRITE_OFF';
            if (input.targetStatus === 'under_repair')
                eventType = 'REPAIR_START';
            if (serial.status === 'under_repair' && input.targetStatus === 'in_stock')
                eventType = 'REPAIR_END';
            this.serialRepo.logHistory({
                businessId: input.businessId,
                serialNumberId: serial.id,
                eventType: eventType,
                fromStatus: serial.status,
                toStatus: input.targetStatus,
                fromLocationId: serial.currentLocationId,
                toLocationId: input.destinationLocationId || serial.currentLocationId,
                notes: input.notes,
                performedBy: input.userId
            });
            return this.serialRepo.findById(serial.id);
        });
        return tx();
    }
    // =========================================================================
    // 6. SEARCH & DETAILED AUDIT TRAIL
    // =========================================================================
    searchSerials(query, actorPermissions = []) {
        const res = this.serialRepo.searchSerials(query);
        const canViewCost = actorPermissions.includes(roles_permissions_1.Permission.VIEW_COST_PRICES);
        if (!canViewCost) {
            res.items = res.items.map((item) => ({
                ...item,
                unitCostMinor: null
            }));
        }
        return res;
    }
    getSerialAudit(businessId, serialIdentifier, actorPermissions = []) {
        let serial = this.serialRepo.findById(serialIdentifier);
        if (!serial) {
            serial = this.serialRepo.findBySerialNumberAnyProduct(businessId, serialIdentifier);
        }
        if (!serial) {
            serial = this.serialRepo.findByImei(businessId, serialIdentifier);
        }
        if (!serial) {
            throw new serial_rules_1.SerialNotFoundError(serialIdentifier);
        }
        const product = this.productRepo.findById(serial.productId);
        const location = serial.currentLocationId
            ? this.locationRepo.findById(serial.currentLocationId, businessId)
            : null;
        let supplier = null;
        if (serial.supplierId) {
            supplier = this.db.prepare('SELECT id, name FROM suppliers WHERE id = ?').get(serial.supplierId);
        }
        const rawWarranty = this.serialRepo.getWarrantyForSerial(serial.id);
        let warranty = null;
        if (rawWarranty) {
            const today = new Date().toISOString().substring(0, 10);
            const isActive = (0, serial_math_1.isWarrantyActive)(rawWarranty.warrantyStartDate, rawWarranty.warrantyEndDate, today);
            const daysRemaining = (0, serial_math_1.calculateWarrantyDaysRemaining)(rawWarranty.warrantyEndDate, today);
            warranty = {
                ...rawWarranty,
                isActive,
                daysRemaining
            };
        }
        const saleInfo = this.serialRepo.getSaleForSerial(serial.id);
        const history = this.serialRepo.getHistory(serial.id);
        // Permission checks
        const canViewCost = actorPermissions.includes(roles_permissions_1.Permission.VIEW_COST_PRICES);
        const canViewPii = actorPermissions.includes(roles_permissions_1.Permission.VIEW_CUSTOMER_PII);
        const safeSerial = {
            ...serial,
            unitCostMinor: canViewCost ? serial.unitCostMinor : null
        };
        let safeSale = null;
        if (saleInfo) {
            safeSale = {
                saleId: saleInfo.sale_id,
                invoiceNumber: saleInfo.invoice_number,
                saleDate: saleInfo.sale_date,
                customerName: canViewPii ? saleInfo.customer_name : this.maskString(saleInfo.customer_name),
                customerPhone: canViewPii ? saleInfo.customer_phone : this.maskPhone(saleInfo.customer_phone)
            };
        }
        return {
            serial: safeSerial,
            product: {
                id: String(product?.id || serial.productId),
                name: product?.name || 'Unknown Product',
                sku: product?.sku || 'N/A'
            },
            location: location ? { id: location.id, name: location.name } : null,
            supplier: supplier ? { id: supplier.id, name: supplier.name } : null,
            warranty,
            sale: safeSale,
            history,
            maskedCost: !canViewCost,
            maskedCustomerPii: !canViewPii
        };
    }
    maskString(val) {
        if (!val)
            return null;
        if (val.length <= 2)
            return '**';
        return val.charAt(0) + '***' + val.charAt(val.length - 1);
    }
    maskPhone(phone) {
        if (!phone)
            return null;
        if (phone.length <= 4)
            return '****';
        return phone.substring(0, 4) + '****' + phone.substring(phone.length - 2);
    }
}
exports.SerialTrackingService = SerialTrackingService;
