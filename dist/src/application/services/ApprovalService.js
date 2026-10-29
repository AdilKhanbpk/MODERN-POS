"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApprovalService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const connection_1 = require("../../infrastructure/sqlite/connection");
const RbacService_1 = require("../authorization/RbacService");
const AppError_1 = require("../../shared/errors/AppError");
class ApprovalService {
    db;
    rbac;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
        this.rbac = new RbacService_1.RbacService(this.db);
    }
    /**
     * Retrieves approval policy configuration from business settings.
     */
    getApprovalPolicy(businessId) {
        const row = this.db
            .prepare("SELECT setting_value FROM business_settings WHERE business_id = ? AND setting_key = 'approval_policy'")
            .get(businessId);
        if (row?.setting_value) {
            try {
                return JSON.parse(row.setting_value);
            }
            catch {
                // fall through
            }
        }
        return {
            maxDiscountPercentWithoutApproval: 10,
            allowSelfApproval: false,
            requireNegativeStockApproval: true,
            maxAdjustmentValueWithoutApprovalMinor: 500000 // Rs 5,000
        };
    }
    /**
     * Submits a supervisor approval request for a sensitive operational override.
     */
    createRequest(context, params) {
        if (!context) {
            throw new AppError_1.ForbiddenError('Authentication context required to request approval.');
        }
        const branchId = params.branchId ||
            context.branchId ||
            this.db.prepare('SELECT id FROM branches WHERE business_id = ? LIMIT 1').get(context.businessId)?.id;
        if (!branchId) {
            throw new AppError_1.ValidationError('A valid branch ID is required for supervisor approval routing.');
        }
        const requestId = crypto_1.default.randomUUID();
        const origStr = params.originalValue !== undefined ? String(params.originalValue) : null;
        const propStr = params.proposedValue !== undefined ? String(params.proposedValue) : null;
        const dataJson = params.requestData ? JSON.stringify(params.requestData) : null;
        this.db
            .prepare(`INSERT INTO approval_requests (
          id, business_id, branch_id, request_type, entity_type, entity_id,
          requested_by, request_data, original_value, proposed_value, reason, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`)
            .run(requestId, context.businessId, branchId, params.requestType, params.entityType, params.entityId || null, context.userId, dataJson, origStr, propStr, params.reason?.trim() || null);
        // Audit log
        this.db
            .prepare(`INSERT INTO audit_logs (id, business_id, branch_id, user_id, action, entity_type, entity_id, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(crypto_1.default.randomUUID(), context.businessId, branchId, context.userId, 'APPROVAL_REQUESTED', 'approval_request', requestId, `User "${context.username}" requested approval for "${params.requestType}"`);
        return this.getRequest(requestId);
    }
    /**
     * Authoritative supervisor decision (APPROVED or REJECTED).
     * Strictly enforces that an employee cannot approve their own request unless configured.
     */
    decideRequest(context, params) {
        // 1. Fetch existing request
        const req = this.db
            .prepare('SELECT * FROM approval_requests WHERE id = ?')
            .get(params.requestId);
        if (!req) {
            throw new AppError_1.NotFoundError('Approval request', params.requestId);
        }
        if (req.status !== 'PENDING') {
            throw new AppError_1.ConflictError(`This approval request is already finalized with status: ${req.status}`);
        }
        // 2. Enforce self-approval prevention rule
        if (req.requested_by === context.userId) {
            const policy = this.getApprovalPolicy(context.businessId);
            if (!policy.allowSelfApproval) {
                throw new AppError_1.ForbiddenError('Self-approval violation: An employee cannot approve their own override request.');
            }
        }
        // 3. Enforce approval decision permission
        this.rbac.assertPermission(context, 'approvals.decide', 'Decide supervisor approval request');
        // 4. Update status atomically
        const decidedAt = new Date().toISOString();
        this.db
            .prepare(`UPDATE approval_requests
         SET status = ?,
             approved_by = ?,
             decided_at = ?
         WHERE id = ?`)
            .run(params.decision, context.userId, decidedAt, params.requestId);
        // 5. Audit log
        this.db
            .prepare(`INSERT INTO audit_logs (id, business_id, branch_id, user_id, action, entity_type, entity_id, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(crypto_1.default.randomUUID(), req.business_id, req.branch_id, context.userId, params.decision === 'APPROVED' ? 'APPROVAL_APPROVED' : 'APPROVAL_REJECTED', 'approval_request', params.requestId, `Supervisor "${context.username}" ${params.decision.toLowerCase()} request "${req.request_type}". Note: ${params.reason || 'None'}`);
        return this.getRequest(params.requestId);
    }
    /**
     * Retrieves an approval request by ID with joined user names.
     */
    getRequest(requestId) {
        const row = this.db
            .prepare(`SELECT ar.*,
                req_u.username as requesting_user_name,
                app_u.username as approving_user_name
         FROM approval_requests ar
         LEFT JOIN users req_u ON ar.requested_by = req_u.id
         LEFT JOIN users app_u ON ar.approved_by = app_u.id
         WHERE ar.id = ?`)
            .get(requestId);
        if (!row)
            return null;
        let requestData;
        if (row.request_data) {
            try {
                requestData = JSON.parse(row.request_data);
            }
            catch {
                // ignore
            }
        }
        return {
            id: row.id,
            businessId: row.business_id,
            branchId: row.branch_id,
            requestType: row.request_type,
            entityType: row.entity_type,
            entityId: row.entity_id,
            requestedBy: row.requested_by,
            approvedBy: row.approved_by,
            requestData,
            originalValue: row.original_value,
            proposedValue: row.proposed_value,
            reason: row.reason,
            status: row.status,
            requestedAt: row.requested_at,
            decidedAt: row.decided_at,
            requestingUserName: row.requesting_user_name,
            approvingUserName: row.approving_user_name
        };
    }
    /**
     * Lists pending approval requests for the business or specific branch.
     */
    listPending(context, branchId) {
        const targetBranch = branchId || context.branchId;
        let sql = `
      SELECT ar.*,
             req_u.username as requesting_user_name,
             app_u.username as approving_user_name
      FROM approval_requests ar
      LEFT JOIN users req_u ON ar.requested_by = req_u.id
      LEFT JOIN users app_u ON ar.approved_by = app_u.id
      WHERE ar.business_id = ? AND ar.status = 'PENDING'
    `;
        const params = [context.businessId];
        if (targetBranch) {
            sql += ' AND ar.branch_id = ?';
            params.push(targetBranch);
        }
        sql += ' ORDER BY ar.requested_at DESC';
        const rows = this.db.prepare(sql).all(...params);
        return rows.map(row => {
            let requestData;
            if (row.request_data) {
                try {
                    requestData = JSON.parse(row.request_data);
                }
                catch {
                    // ignore
                }
            }
            return {
                id: row.id,
                businessId: row.business_id,
                branchId: row.branch_id,
                requestType: row.request_type,
                entityType: row.entity_type,
                entityId: row.entity_id,
                requestedBy: row.requested_by,
                approvedBy: row.approved_by,
                requestData,
                originalValue: row.original_value,
                proposedValue: row.proposed_value,
                reason: row.reason,
                status: row.status,
                requestedAt: row.requested_at,
                decidedAt: row.decided_at,
                requestingUserName: row.requesting_user_name,
                approvingUserName: row.approving_user_name
            };
        });
    }
}
exports.ApprovalService = ApprovalService;
