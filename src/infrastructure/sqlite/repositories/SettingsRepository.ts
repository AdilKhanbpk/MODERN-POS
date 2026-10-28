import Database from 'better-sqlite3';
import { getDatabase } from '../connection';
import { SystemSettings } from '../../../shared/types';
import { ISettingsRepository } from '../../../shared/interfaces/repositories/ISettingsRepository';

export class SettingsRepository implements ISettingsRepository {
  constructor(private db: Database.Database = getDatabase()) {}

  public getSettings(): SystemSettings {
    const rows = this.db.prepare('SELECT key, value FROM system_settings').all() as Array<{ key: string; value: string }>;
    const map: Record<string, string> = {};
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

  public saveSettings(settings: Partial<SystemSettings>): void {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(settings)) {
      stmt.run(k, String(v));
    }
  }

  public getAppSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  public setAppSetting(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)').run(key, value);
  }
}
