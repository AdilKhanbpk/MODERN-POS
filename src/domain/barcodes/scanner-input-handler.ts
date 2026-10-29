import { ScannerConfig } from '../../shared/types/barcode';

export interface ScannerInputCallbacks {
  onScan: (barcode: string) => void;
  onDuplicateScan?: (barcode: string) => void;
  onError?: (error: string) => void;
}

export class ScannerInputHandler {
  private buffer = '';
  private lastKeyTimestamp = 0;
  private lastScanBarcode = '';
  private lastScanTimestamp = 0;

  private config: ScannerConfig;

  constructor(
    private callbacks: ScannerInputCallbacks,
    customConfig?: Partial<ScannerConfig>
  ) {
    this.config = {
      enabled: true,
      prefix: '',
      suffix: 'Enter',
      minLength: 3,
      maxInterKeyTimeMs: 50,
      duplicateTimeoutMs: 500,
      ...customConfig
    };
  }

  public updateConfig(newConfig: Partial<ScannerConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public getConfig(): ScannerConfig {
    return { ...this.config };
  }

  public reset(): void {
    this.buffer = '';
    this.lastKeyTimestamp = 0;
  }

  /**
   * Processes a single keydown or input event.
   * Can be driven by DOM KeyboardEvent or simulated keystrokes in tests.
   */
  public handleKeyEvent(event: {
    key: string;
    targetIsInput?: boolean;
    timestamp?: number;
  }): boolean {
    if (!this.config.enabled) return false;

    const now = event.timestamp !== undefined ? event.timestamp : Date.now();
    const timeDelta = this.lastKeyTimestamp > 0 ? now - this.lastKeyTimestamp : 0;
    this.lastKeyTimestamp = now;

    const key = event.key;

    // Check if key matches configured suffix (e.g. 'Enter', 'Tab', '\r', '\n', '\t')
    const isSuffix =
      key === this.config.suffix ||
      (this.config.suffix === 'Enter' && (key === 'Enter' || key === '\r' || key === '\n')) ||
      (this.config.suffix === 'Tab' && (key === 'Tab' || key === '\t'));

    if (isSuffix) {
      if (this.buffer.length >= this.config.minLength) {
        let barcode = this.buffer.trim();

        // Strip prefix if configured
        if (this.config.prefix && barcode.startsWith(this.config.prefix)) {
          barcode = barcode.substring(this.config.prefix.length);
        }

        // Duplicate scan check within debounce window
        const timeSinceLastScan = now - this.lastScanTimestamp;
        if (barcode === this.lastScanBarcode && timeSinceLastScan < this.config.duplicateTimeoutMs) {
          if (this.callbacks.onDuplicateScan) {
            this.callbacks.onDuplicateScan(barcode);
          }
        } else {
          this.lastScanBarcode = barcode;
          this.lastScanTimestamp = now;
          this.callbacks.onScan(barcode);
        }

        this.reset();
        return true; // Barcode scan handled
      } else {
        this.reset();
        return false;
      }
    }

    // Single character input
    if (key.length === 1) {
      // If timing delta exceeded maximum wedge burst time and user was in an input field,
      // it is human typing: reset the scanner buffer.
      if (timeDelta > this.config.maxInterKeyTimeMs && event.targetIsInput) {
        this.buffer = key;
      } else {
        this.buffer += key;
      }
      return false;
    }

    // Ignore other special control keys (Shift, Alt, etc.)
    return false;
  }

  /**
   * Helper to simulate a complete hardware scanner wedge stream in tests or automated flows.
   */
  public simulateScannerStream(barcode: string, keyIntervalMs = 10, suffix = 'Enter'): void {
    let currentVirtualTime = Date.now();
    for (const char of barcode) {
      this.handleKeyEvent({ key: char, timestamp: currentVirtualTime });
      currentVirtualTime += keyIntervalMs;
    }
    this.handleKeyEvent({ key: suffix, timestamp: currentVirtualTime });
  }
}

