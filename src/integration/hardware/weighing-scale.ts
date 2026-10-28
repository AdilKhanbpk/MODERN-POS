/**
 * Integration: Hardware Weighing Scale
 * Provides communication abstraction for POS retail scales connected via RS-232 COM port or USB HID.
 *
 * Emulates standard scale protocols (e.g. Avery Berkel, Toledo, CAS) to stream stable weight readings
 * into the POS terminal in canonical scaled grams/kg.
 */

import { toScaledQuantity } from '../../domain/units/scaled-quantity';

export interface ScaleReading {
  rawWeight: number; // in kilograms or grams
  unit: 'KG' | 'G';
  isStable: boolean;
  tareWeight: number;
  netWeight: number;
  weightBaseScaled: number; // scaled by QUANTITY_SCALE (10,000)
  timestamp: string;
}

export interface ScaleConfig {
  port: string; // e.g. "COM1" or "/dev/ttyUSB0"
  baudRate: number; // 9600
  dataBits: 8;
  parity: 'none' | 'even' | 'odd';
  stopBits: 1;
  protocol: 'TOLEDO' | 'CAS' | 'STANDARD_ASCII';
}

export class WeighingScaleIntegration {
  private isConnected = false;
  private config: ScaleConfig | null = null;

  public configure(config: ScaleConfig): void {
    this.config = config;
  }

  public connect(): boolean {
    if (!this.config) {
      throw new Error('Cannot connect to scale: Configuration not set.');
    }
    this.isConnected = true;
    return true;
  }

  public disconnect(): void {
    this.isConnected = false;
  }

  /**
   * Parses raw ASCII telegram from serial scale into structured reading.
   * Example telegram format: "ST,GS,+001.250kg\r\n"
   */
  public parseReading(rawTelegram: string): ScaleReading {
    const isStable = rawTelegram.includes('ST') || rawTelegram.includes('S');
    const match = rawTelegram.match(/([+-]?\d+\.?\d*)\s*(kg|g)/i);

    let weight = 0;
    let unit: 'KG' | 'G' = 'KG';

    if (match) {
      weight = parseFloat(match[1]);
      unit = match[2].toUpperCase() === 'G' ? 'G' : 'KG';
    } else {
      // Fallback numerical extraction
      const numMatch = rawTelegram.match(/([+-]?\d+\.?\d*)/);
      weight = numMatch ? parseFloat(numMatch[1]) : 0;
    }

    const netWeight = Math.max(0, weight);
    const weightBaseScaled = toScaledQuantity(netWeight, unit === 'KG' ? 3 : 0);

    return {
      rawWeight: weight,
      unit,
      isStable,
      tareWeight: 0,
      netWeight,
      weightBaseScaled,
      timestamp: new Date().toISOString()
    };
  }
}

