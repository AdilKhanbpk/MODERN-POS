import Database from 'better-sqlite3';
import { getDatabase } from '../connection';

export class SequenceRepository {
  constructor(private db: Database.Database = getDatabase()) {}

  /**
   * Atomically generates and increments the next document sequence number.
   * e.g., INV-1001, PO-2001, PAY-3001
   */
  public getNextSequence(documentType: string): string {
    const row = this.db.prepare(`
      SELECT prefix, next_number as nextNumber
      FROM document_sequences
      WHERE document_type = ?
    `).get(documentType) as { prefix: string; nextNumber: number } | undefined;

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

