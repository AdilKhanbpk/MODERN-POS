"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ThermalPrinterService = void 0;
const electron_1 = require("electron");
const SettingsService_1 = require("../../../src/application/services/SettingsService");
class ThermalPrinterService {
    settingsService;
    constructor() {
        this.settingsService = new SettingsService_1.SettingsService();
    }
    async getPrinters() {
        const focusedWindow = electron_1.BrowserWindow.getFocusedWindow();
        if (!focusedWindow)
            return [];
        return await focusedWindow.webContents.getPrintersAsync();
    }
    generateReceiptHtml(sale) {
        const settings = this.settingsService.getSettings();
        const curr = settings.currencySymbol;
        const itemsHtml = (sale.items || []).map((item) => `
      <tr>
        <td style="text-align:left; padding: 2px 0;">
          <div>${item.productName}</div>
          <small style="color:#555;">${item.quantity} ${item.unitName} x ${curr}${(item.unitPrice / 100).toFixed(2)}</small>
        </td>
        <td style="text-align:right; vertical-align:top; padding: 2px 0;">
          ${curr}${(item.lineTotal / 100).toFixed(2)}
        </td>
      </tr>
    `).join('');
        return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          @page {
            size: 80mm auto;
            margin: 0;
          }
          body {
            font-family: 'Courier New', Courier, monospace;
            width: 76mm;
            margin: 2mm auto;
            font-size: 11px;
            line-height: 1.25;
            color: #000;
          }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .divider { border-bottom: 1px dashed #000; margin: 4px 0; }
          .double-divider { border-bottom: 2px solid #000; margin: 6px 0; }
          table { width: 100%; border-collapse: collapse; }
          .bold { font-weight: bold; }
          .title { font-size: 15px; font-weight: bold; margin-bottom: 2px; }
        </style>
      </head>
      <body>
        <div class="text-center">
          <div class="title">${settings.storeName}</div>
          <div>${settings.storeAddress}</div>
          <div>Phone: ${settings.storePhone}</div>
          <div class="divider"></div>
          <div class="bold">CASH RECEIPT</div>
          <div>Invoice: ${sale.invoiceNumber}</div>
          <div>Date: ${new Date(sale.createdAt).toLocaleString()}</div>
          <div>Cashier: ${sale.cashierName || 'Staff'}</div>
        </div>
        <div class="divider"></div>
        <table>
          <thead>
            <tr style="border-bottom: 1px solid #000;">
              <th style="text-align:left;">Item</th>
              <th style="text-align:right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>
        <div class="divider"></div>
        <table>
          <tr>
            <td>Subtotal:</td>
            <td class="text-right">${curr}${(sale.subtotal / 100).toFixed(2)}</td>
          </tr>
          ${sale.totalDiscount > 0 ? `
          <tr>
            <td>Discount:</td>
            <td class="text-right">-${curr}${(sale.totalDiscount / 100).toFixed(2)}</td>
          </tr>` : ''}
          ${sale.totalTax > 0 ? `
          <tr>
            <td>Tax:</td>
            <td class="text-right">${curr}${(sale.totalTax / 100).toFixed(2)}</td>
          </tr>` : ''}
          <tr class="bold" style="font-size: 13px;">
            <td>GRAND TOTAL:</td>
            <td class="text-right">${curr}${(sale.grandTotal / 100).toFixed(2)}</td>
          </tr>
          <tr>
            <td>Paid (${sale.paymentMethod}):</td>
            <td class="text-right">${curr}${(sale.amountPaid / 100).toFixed(2)}</td>
          </tr>
          ${sale.changeGiven > 0 ? `
          <tr>
            <td>Change:</td>
            <td class="text-right">${curr}${(sale.changeGiven / 100).toFixed(2)}</td>
          </tr>` : ''}
          ${sale.customerBalanceChange > 0 ? `
          <tr class="bold">
            <td>Added to Dues:</td>
            <td class="text-right">${curr}${(sale.customerBalanceChange / 100).toFixed(2)}</td>
          </tr>` : ''}
        </table>
        <div class="double-divider"></div>
        <div class="text-center">
          <div>${settings.receiptHeader}</div>
          <div>${settings.receiptFooter}</div>
        </div>
      </body>
      </html>
    `;
    }
    async printReceipt(sale) {
        const settings = this.settingsService.getSettings();
        const html = this.generateReceiptHtml(sale);
        // Create an invisible offscreen print window
        const printWindow = new electron_1.BrowserWindow({
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true
            }
        });
        await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        return new Promise((resolve) => {
            const printOptions = {
                silent: settings.autoPrintReceipt && Boolean(settings.printerName),
                printBackground: true,
                deviceName: settings.printerName || undefined
            };
            printWindow.webContents.print(printOptions, (success, failureReason) => {
                printWindow.destroy();
                if (success) {
                    resolve({ success: true });
                }
                else {
                    resolve({ success: false, message: failureReason });
                }
            });
        });
    }
}
exports.ThermalPrinterService = ThermalPrinterService;
