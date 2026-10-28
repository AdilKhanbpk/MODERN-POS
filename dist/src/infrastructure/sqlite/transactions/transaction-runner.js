"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionRunner = void 0;
const connection_1 = require("../connection");
class TransactionRunner {
    /**
     * Executes a callback within a strict SQLite transaction.
     * If any error is thrown, the entire operation is automatically rolled back.
     */
    static run(callback, customDb) {
        const db = customDb || (0, connection_1.getDatabase)();
        const trx = db.transaction(() => {
            return callback(db);
        });
        return trx();
    }
}
exports.TransactionRunner = TransactionRunner;
