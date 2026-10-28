"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SequenceRepository = void 0;
const connection_1 = require("../connection");
class SequenceRepository {
    db;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
    }
    /**
     * Atomically generates and increments the next document sequence number.
     * e.g., INV-1001, PO-2001, PAY-3001
     */
    getNextSequence(documentType) {
        const row = this.db.prepare(`
      SELECT prefix, next_number as nextNumber
      FROM document_sequences
      WHERE document_type = ?
    `).get(documentType);
        if (!row) {
            // Fallback
            return `${documentType}-${Date.now().toString().slice(-6)}`;
        }
        // Increment next_number atomically
        this.db.prepare(`
      UPDATE document_sequences
      SET next_number = next_number + 1
      WHERE document_type = ?
    `).run(documentType);
        return `${row.prefix}-${row.nextNumber}`;
    }
}
exports.SequenceRepository = SequenceRepository;
