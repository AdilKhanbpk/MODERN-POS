import { useEffect, useRef } from 'react';
import { ScannerInputHandler, ScannerInputCallbacks } from '../../domain/barcodes/scanner-input-handler';
import { ScannerConfig } from '../../shared/types/barcode';

export function useBarcodeScanner(
  callbacks: ScannerInputCallbacks,
  customConfig?: Partial<ScannerConfig>
): void {
  const handlerRef = useRef<ScannerInputHandler | null>(null);

  useEffect(() => {
    handlerRef.current = new ScannerInputHandler(callbacks, customConfig);

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const targetIsInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;

      const handled = handlerRef.current?.handleKeyEvent({
        key: e.key,
        targetIsInput,
        timestamp: Date.now()
      });

      if (handled) {
        // Prevent default if scanner suffix was Enter or Tab to avoid submitting unrelated forms
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [callbacks.onScan, callbacks.onDuplicateScan]);
}

