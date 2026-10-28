# User & Cashier Operating Guide — Modern Retail POS

## 1. Getting Started & Offline Sign-In

The application operates completely offline on your Windows desktop. No internet connection is ever required.

1. **Launch the Application**: Run the executable or `npm start`.
2. **Sign In**:
   - Default Administrator Username: `admin`
   - Default Password: `admin123`
   *(You can change your password anytime under System Settings).*

---

## 2. Cashier POS Terminal Workflow (F1)

The POS terminal is designed for high-speed touch and barcode scanning operations:

```
[ Scan Barcode / SKU ] ──▶ [ Cart Auto-Updates ] ──▶ [ Select Customer ] ──▶ [ Charge / Settle ] ──▶ [ Print Thermal Receipt ]
```

### Steps:
1. **Scanning Items**: Focus is automatically on the barcode input box. Scan any item or type its barcode/SKU and press **Enter**.
2. **Product Name Search**: Use the search box on the top right to search products by title.
3. **Quantity Adjustments**: Click **+** or **-** next to any item in the cart to update quantity.
4. **Discounts**: Enter an order-level discount percentage in the bottom right panel. The grand total recalculates instantly via the backend domain layer.
5. **Customer Selection**: Defaults to `Walk-in Customer`. Select a registered customer to view their existing credit balance and credit limit.
6. **Charging the Order**: Click the green **Charge** button:
   - **Cash Payment**: Enter the amount tendered by the customer (or click quick cash buttons: `+Rs. 100`, `+Rs. 500`, `+Rs. 1000`, `+Rs. 5000`). Change due is displayed in real-time.
   - **Card Payment**: Select `Card` and confirm.
   - **On Account (Credit)**: If the customer pays partially or on credit, the remaining unpaid balance is automatically added to their customer ledger (subject to their credit limit).
7. **Receipt Printing**: The 80mm cash receipt is formatted and printed silently to your thermal receipt printer.

---

## 3. Inventory Management (F2)

1. **Add New Products**: Click **Add Product**, enter barcode, SKU, cost price, retail price, packaging unit, and reorder threshold.
2. **Stock Adjustments**: When performing physical inventory counts, click the **Adjust Stock** icon ($\updownarrow$) next to any product:
   - *Count Increase (+)*: Found extra stock.
   - *Damaged Goods (-)*: Write-off damaged inventory.
   - *Theft / Shrinkage (-)*: Write-off missing items.
   All adjustments log an immutable audit trail entry in `stock_movements`.

---

## 4. Purchases & Supplier Receiving

1. Click **Purchases** from the sidebar.
2. Click **Receive Purchase**.
3. Select the Supplier, enter the vendor bill number, select items received, unit purchase cost, and any extra freight or landed costs.
4. The system automatically updates product stock and recalculates moving weighted average cost (MAC).
5. Any unpaid balance is posted to the supplier's accounts payable ledger.

---

## 5. Customer Credit Management & Dues Settlement

1. Navigate to **Customers**.
2. Customers with outstanding balances are highlighted in amber.
3. Click **Settle** to record cash payments collected from a customer.
4. Click the **History** icon to inspect the full chronological customer ledger statement showing every invoice, payment, and running balance.

---

## 6. Daily Register Closing & Z-Report

At the end of every business day:
1. Navigate to **Reports & Z-Close**.
2. Select today's date under **Daily Z-Report**.
3. Review total transactions, gross sales, discounts, net sales, taxes collected, COGS, gross profit, and daily operating expenses.
4. Compare the **Cash in Drawer (Physical)** value against the cash physically present in your register cash drawer.
5. Click **Print Z-Report** to print the official closing slip.

---

## 7. Database Backup & Disaster Recovery

1. Navigate to **Settings & Backup**.
2. Click **Generate Backup Snapshot Now**.
3. A timestamped SQLite snapshot (`pos-backup-YYYY-MM-DD...sqlite`) will be created in your local `backups/` directory using SQLite's safe `VACUUM INTO` engine.
4. In addition, the POS automatically takes a snapshot upon application exit if `autoBackupOnClose` is enabled.
5. Backups can be copied to a USB drive for off-site redundancy without interrupting active POS operations.

---

## 8. Keyboard Shortcuts Quick Reference

| Shortcut | Action |
|---|---|
| `F1` | Open POS Terminal / Cash Register |
| `F2` | Open Product Inventory Catalog |
| `F3` | Open Customers & Credit Directory |
| `F4` | Open Daily Financial Reports & Z-Report |
| `Enter` (in Barcode box) | Add scanned barcode to cart |
| `Tab` | Switch between input fields |

