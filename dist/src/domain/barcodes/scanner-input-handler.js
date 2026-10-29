"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScannerInputHandler = void 0;
class ScannerInputHandler {
    callbacks;
    buffer = '';
    lastKeyTimestamp = 0;
    lastScanBarcode = '';
    lastScanTimestamp = 0;
    config;
    constructor(callbacks, customConfig) {
        this.callbacks = callbacks;
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
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
    }
    getConfig() {
        return { ...this.config };
    }
    reset() {
        this.buffer = '';
        this.lastKeyTimestamp = 0;
    }
    /**
     * Processes a single keydown or input event.
     * Can be driven by DOM KeyboardEvent or simulated keystrokes in tests.
     */
    handleKeyEvent(event) {
        if (!this.config.enabled)
            return false;
        const now = event.timestamp !== undefined ? event.timestamp : Date.now();
        const timeDelta = this.lastKeyTimestamp > 0 ? now - this.lastKeyTimestamp : 0;
        this.lastKeyTimestamp = now;
        const key = event.key;
        // Check if key matches configured suffix (e.g. 'Enter', 'Tab', '\r', '\n', '\t')
        const isSuffix = key === this.config.suffix ||
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
                }
                else {
                    this.lastScanBarcode = barcode;
                    this.lastScanTimestamp = now;
                    this.callbacks.onScan(barcode);
                }
                this.reset();
                return true; // Barcode scan handled
            }
            else {
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
            }
            else {
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
    simulateScannerStream(barcode, keyIntervalMs = 10, suffix = 'Enter') {
        let currentVirtualTime = Date.now();
        for (const char of barcode) {
            this.handleKeyEvent({ key: char, timestamp: currentVirtualTime });
            currentVirtualTime += keyIntervalMs;
        }
        this.handleKeyEvent({ key: suffix, timestamp: currentVirtualTime });
    }
}
exports.ScannerInputHandler = ScannerInputHandler;
