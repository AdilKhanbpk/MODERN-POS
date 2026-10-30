"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StocktakeService = void 0;
const StocktakeRepository_1 = require("../../infrastructure/sqlite/repositories/StocktakeRepository");
const stocktake_rules_1 = require("../../domain/inventory/stocktake-rules");
class StocktakeService {
    db;
    repo;
    constructor(db) {
        this.db = db;
        this.repo = new StocktakeRepository_1.StocktakeRepository(db);
    }
    /**
     * Evaluates if actor has supervisor/manager/owner privileges.
     */
    isSupervisorOrAbove(role) {
        if (!role)
            return false;
        const elevated = ['owner', 'admin', 'manager', 'supervisor', 'OWNER', 'ADMIN', 'MANAGER', 'SUPERVISOR'];
        return elevated.includes(role);
    }
    /**
     * 1. Create Stocktake
     */
    createStocktake(dto, actor) {
        const bizId = actor.businessId || dto.businessId || '00000000-0000-0000-0000-000000000001';
        const branchId = actor.branchId || dto.branchId || '00000000-0000-0000-0000-000000000002';
        // Verify if location is already frozen by another active stocktake
        if (dto.freezeStock) {
            const existing = this.repo.findActiveFrozenStocktake(dto.stockLocationId);
            if (existing) {
                throw new Error(`Location is already frozen by active Stocktake #${existing.stocktake_number}. Cannot freeze multiple times.`);
            }
        }
        const created = this.repo.createStocktake({
            ...dto,
            businessId: bizId,
            branchId
        }, String(actor.userId));
        return this.maskStocktakeForActor(created, actor);
    }
    /**
     * 2. Start Stocktake
     */
    startStocktake(stocktakeId, actor) {
        this.repo.startStocktake(stocktakeId);
        return this.getStocktakeById(stocktakeId, actor);
    }
    /**
     * 3. Enter/Scan Counts
     */
    recordCount(dto, actor) {
        const line = this.repo.recordCount(dto, String(actor.userId));
        const st = this.repo.getStocktakeById(dto.stocktakeId);
        const isAuthorized = this.isSupervisorOrAbove(actor.role);
        return stocktake_rules_1.StocktakeRules.maskBlindLineData(line, st?.countingMode || 'blind', isAuthorized);
    }
    /**
     * 4. Resolve Discrepancy (Recount Acceptance, Supervisor Override, Abandon)
     */
    resolveDiscrepancy(dto, actor) {
        if (!this.isSupervisorOrAbove(actor.role)) {
            throw new stocktake_rules_1.StocktakeSecurityError('Resolving stock discrepancies requires supervisor or manager role.');
        }
        const line = this.repo.resolveDiscrepancy(dto, String(actor.userId));
        const st = this.repo.getStocktakeById(dto.stocktakeId);
        return stocktake_rules_1.StocktakeRules.maskBlindLineData(line, st?.countingMode || 'blind', true);
    }
    /**
     * 5. Submit Counts
     */
    submitCounts(stocktakeId, actor) {
        this.repo.submitCounts(stocktakeId, String(actor.userId));
        return this.getStocktakeById(stocktakeId, actor);
    }
    /**
     * 6. Move to Review State
     */
    reviewStocktake(stocktakeId, actor) {
        if (!this.isSupervisorOrAbove(actor.role)) {
            throw new stocktake_rules_1.StocktakeSecurityError('Reviewing stocktakes requires supervisor or manager role.');
        }
        this.repo.reviewStocktake(stocktakeId);
        return this.getStocktakeById(stocktakeId, actor);
    }
    /**
     * 7. Approve Stocktake
     */
    approveStocktake(stocktakeId, actor) {
        if (!this.isSupervisorOrAbove(actor.role)) {
            throw new stocktake_rules_1.StocktakeSecurityError('Approving stocktakes requires supervisor, manager, or owner role.');
        }
        this.repo.approveStocktake(stocktakeId, String(actor.userId));
        return this.getStocktakeById(stocktakeId, actor);
    }
    /**
     * 8. Post Stocktake
     */
    postStocktake(stocktakeId, actor) {
        if (!this.isSupervisorOrAbove(actor.role)) {
            throw new stocktake_rules_1.StocktakeSecurityError('Posting stocktakes requires manager or owner privileges.');
        }
        const posted = this.repo.postStocktake(stocktakeId, String(actor.userId));
        return this.maskStocktakeForActor(posted, actor);
    }
    /**
     * 9. Cancel Stocktake
     */
    cancelStocktake(stocktakeId, reason, actor) {
        if (!this.isSupervisorOrAbove(actor.role)) {
            throw new stocktake_rules_1.StocktakeSecurityError('Cancelling a stocktake requires manager or supervisor role.');
        }
        this.repo.cancelStocktake(stocktakeId, reason);
        return this.getStocktakeById(stocktakeId, actor);
    }
    /**
     * 10. Get Stocktake Details (Enforces Server-Side Blind Masking)
     */
    getStocktakeById(id, actor) {
        const st = this.repo.getStocktakeById(id);
        if (!st)
            return null;
        return this.maskStocktakeForActor(st, actor);
    }
    /**
     * Masks sensitive fields when blind counting is active and user is not an authorized reviewer.
     */
    maskStocktakeForActor(st, actor) {
        // If visible mode, no masking
        if (st.countingMode !== 'blind') {
            return st;
        }
        // In blind mode, if user is supervisor/manager/owner AND status is review/approved/posted, allow full view
        const isElevated = this.isSupervisorOrAbove(actor.role);
        const isReviewOrLater = ['review', 'approved', 'posted'].includes(st.status);
        if (isElevated && isReviewOrLater) {
            return st;
        }
        // Mask lines
        const maskedLines = (st.lines || []).map((line) => stocktake_rules_1.StocktakeRules.maskBlindLineData(line, 'blind', false));
        return {
            ...st,
            discrepancyLinesCount: undefined,
            lines: maskedLines
        };
    }
    /**
     * 11. List Stocktakes
     */
    listStocktakes(filter, actor) {
        const list = this.repo.listStocktakes(filter);
        const isElevated = this.isSupervisorOrAbove(actor.role);
        return list.map((st) => {
            if (st.countingMode === 'blind' && !isElevated) {
                return {
                    ...st,
                    discrepancyLinesCount: undefined
                };
            }
            return st;
        });
    }
    /**
     * 12. Generate Stocktake Report
     */
    getStocktakeReport(stocktakeId, actor) {
        const isElevated = this.isSupervisorOrAbove(actor.role);
        const st = this.repo.getStocktakeById(stocktakeId);
        if (!st)
            throw new Error(`Stocktake ${stocktakeId} not found.`);
        if (st.countingMode === 'blind' && !isElevated && !['review', 'approved', 'posted'].includes(st.status)) {
            throw new stocktake_rules_1.StocktakeSecurityError('Stocktake reports cannot be viewed while counting is blind and in-progress.');
        }
        return this.repo.generateStocktakeReport(stocktakeId);
    }
    /**
     * 13. Policy Management
     */
    getPolicy(businessId) {
        return this.repo.getPolicy(businessId);
    }
    updatePolicy(businessId, policy, actor) {
        if (!this.isSupervisorOrAbove(actor.role)) {
            throw new stocktake_rules_1.StocktakeSecurityError('Updating stocktake discrepancy policies requires manager or owner role.');
        }
        return this.repo.updatePolicy(businessId, policy);
    }
    /**
     * 14. Location Freeze Check Helper
     */
    checkLocationFreeze(stockLocationId) {
        const active = this.repo.findActiveFrozenStocktake(stockLocationId);
        if (active) {
            return {
                isFrozen: true,
                stocktakeNumber: active.stocktake_number,
                stocktakeId: active.id
            };
        }
        return { isFrozen: false };
    }
}
exports.StocktakeService = StocktakeService;
