"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsRepository = void 0;
const connection_1 = require("../connection");
class SettingsRepository {
    db;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
    }
    getSettings() {
        const rows = this.db.prepare('SELECT key, value FROM system_settings').all();
        const map = {};
        for (const r of rows) {
            map[r.key] = r.value;
        }
        return {
            storeName: map.storeName || 'Modern Retail Supermarket',
            storeAddress: map.storeAddress || '',
            storePhone: map.storePhone || '',
            currencySymbol: map.currencySymbol || 'Rs. ',
            currencyCode: map.currencyCode || 'PKR',
            defaultTaxRate: parseFloat(map.defaultTaxRate || '0'),
            isTaxInclusive: map.isTaxInclusive === 'true',
            receiptHeader: map.receiptHeader || 'Thank you for shopping with us!',
            receiptFooter: map.receiptFooter || 'Goods once sold are exchangeable with receipt.',
            printerName: map.printerName || '',
            autoPrintReceipt: map.autoPrintReceipt === 'true',
            backupPath: map.backupPath || './backups',
            autoBackupOnClose: map.autoBackupOnClose === 'true'
        };
    }
    saveSettings(settings) {
        const stmt = this.db.prepare('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)');
        for (const [k, v] of Object.entries(settings)) {
            stmt.run(k, String(v));
        }
    }
}
exports.SettingsRepository = SettingsRepository;
