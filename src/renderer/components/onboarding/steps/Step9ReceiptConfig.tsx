import React from 'react';
import { ReceiptSettingsInput } from '../../../../shared/types/onboarding';

interface Props {
  data: ReceiptSettingsInput;
  onChange: (data: ReceiptSettingsInput) => void;
  errors?: Record<string, string>;
}

export const Step9ReceiptConfig: React.FC<Props> = ({ data, onChange, errors }) => {
  const handleChange = (field: keyof ReceiptSettingsInput, value: any) => {
    onChange({
      ...data,
      [field]: value
    });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 text-slate-100">
      <div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Receipt & Printing Layout</h2>
        <p className="text-sm text-slate-400 mt-1">
          Customize receipt thermal printer parameters, headers, footers, and customer disclosures.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Settings Controls */}
        <div className="lg:col-span-7 space-y-4 bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Receipt Header Business Name <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={data.displayName || ''}
              onChange={e => handleChange('displayName', e.target.value)}
              placeholder="e.g. AL-MADINA SUPERMARKET"
              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2 text-sm text-white outline-none"
            />
            {errors?.['receiptSettings.displayName'] && (
              <p className="text-xs text-rose-400 mt-1">{errors['receiptSettings.displayName']}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Receipt Heading
              </label>
              <input
                type="text"
                value={data.heading || 'SALE INVOICE'}
                onChange={e => handleChange('heading', e.target.value)}
                placeholder="SALE INVOICE"
                className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2 text-sm text-white outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Paper Width
              </label>
              <select
                value={data.paperWidth || '80mm'}
                onChange={e => handleChange('paperWidth', e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2 text-sm text-white outline-none"
              >
                <option value="80mm">80 mm (Standard POS Thermal)</option>
                <option value="58mm">58 mm (Compact Thermal)</option>
                <option value="A4">A4 (Laser / Inkjet Full Page)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Printed Store Phone
              </label>
              <input
                type="text"
                value={data.phone || ''}
                onChange={e => handleChange('phone', e.target.value)}
                placeholder="0300-1234567"
                className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2 text-sm text-white outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Printed Address Line
              </label>
              <input
                type="text"
                value={data.address || ''}
                onChange={e => handleChange('address', e.target.value)}
                placeholder="Sector G-9 Markaz, Islamabad"
                className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2 text-sm text-white outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Receipt Footer Policy Note
            </label>
            <textarea
              rows={2}
              value={data.footerMessage || ''}
              onChange={e => handleChange('footerMessage', e.target.value)}
              placeholder="e.g. Goods once sold can be exchanged within 7 days with original receipt."
              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2 text-sm text-white outline-none"
            />
          </div>

          {/* Visibility Toggles */}
          <div className="pt-2 border-t border-slate-800 space-y-2.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Receipt Elements Visibility
            </label>

            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300">Show Customer Name & Phone</span>
              <input
                type="checkbox"
                checked={data.showCustomerDetails}
                onChange={e => handleChange('showCustomerDetails', e.target.checked)}
                className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 h-4 w-4 bg-slate-950"
              />
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300">Show Breakdown of Tax (GST/VAT)</span>
              <input
                type="checkbox"
                checked={data.showTaxDetails}
                onChange={e => handleChange('showTaxDetails', e.target.checked)}
                className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 h-4 w-4 bg-slate-950"
              />
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300">Show Cashier Operator Name</span>
              <input
                type="checkbox"
                checked={data.showCashierName}
                onChange={e => handleChange('showCashierName', e.target.checked)}
                className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 h-4 w-4 bg-slate-950"
              />
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300">Show Invoice Barcode / QR Code</span>
              <input
                type="checkbox"
                checked={data.showBarcodeOrQr}
                onChange={e => handleChange('showBarcodeOrQr', e.target.checked)}
                className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 h-4 w-4 bg-slate-950"
              />
            </div>
          </div>
        </div>

        {/* Live Thermal Receipt Preview */}
        <div className="lg:col-span-5 flex flex-col items-center">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
            Live Preview ({data.paperWidth || '80mm'})
          </div>

          <div
            className={`bg-white text-black font-mono text-[11px] p-5 rounded-lg shadow-xl shadow-black/40 border border-slate-300 ${
              data.paperWidth === '58mm' ? 'w-56' : 'w-72'
            }`}
          >
            {/* Header */}
            <div className="text-center space-y-0.5 pb-2 border-b border-dashed border-gray-400">
              <div className="font-bold text-sm tracking-wide uppercase">{data.displayName || 'STORE NAME'}</div>
              {data.address && <div className="text-[10px] text-gray-700">{data.address}</div>}
              {data.phone && <div className="text-[10px] text-gray-700">Tel: {data.phone}</div>}
              <div className="font-bold text-[10px] pt-1 tracking-wider uppercase">{data.heading || 'SALE INVOICE'}</div>
            </div>

            {/* Meta */}
            <div className="py-2 border-b border-dashed border-gray-400 text-[10px] space-y-0.5">
              <div className="flex justify-between">
                <span>Inv: #INV-2026-0001</span>
                <span>28/10/2026 14:30</span>
              </div>
              {data.showCashierName && <div>Cashier: admin</div>}
              {data.showCustomerDetails && <div>Customer: Walk-in Customer</div>}
            </div>

            {/* Lines */}
            <div className="py-2 border-b border-dashed border-gray-400 space-y-1 text-[10px]">
              <div className="flex justify-between font-bold">
                <span>ITEM</span>
                <span>QTY x PRICE</span>
                <span>TOTAL</span>
              </div>
              <div className="flex justify-between">
                <span>Organic Basmati Rice</span>
                <span>1 x 350.00</span>
                <span>350.00</span>
              </div>
              <div className="flex justify-between">
                <span>Pure Cooking Oil 1L</span>
                <span>2 x 480.00</span>
                <span>960.00</span>
              </div>
            </div>

            {/* Totals */}
            <div className="py-2 space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>1,310.00</span>
              </div>
              {data.showTaxDetails && (
                <div className="flex justify-between text-gray-700 text-[10px]">
                  <span>GST (18%):</span>
                  <span>235.80</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-xs pt-1 border-t border-gray-300">
                <span>GRAND TOTAL:</span>
                <span>1,545.80</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span>Cash Tendered:</span>
                <span>2,000.00</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span>Change Returned:</span>
                <span>454.20</span>
              </div>
            </div>

            {/* Barcode & Footer */}
            <div className="pt-2 border-t border-dashed border-gray-400 text-center space-y-2">
              {data.showBarcodeOrQr && (
                <div className="py-1">
                  <div className="inline-block tracking-widest text-[9px] border border-black px-3 py-1 font-mono">
                    ||| |||| | ||||| |||||
                  </div>
                </div>
              )}
              {data.footerMessage && (
                <div className="text-[9px] text-gray-700 italic px-2 leading-tight">
                  {data.footerMessage}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

