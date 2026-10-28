# Calculation Rules & Formulas — Modern Retail POS

## 1. Monetary Scale (Integer Minor Units / PKR Paisa)

To prevent IEEE 754 floating-point inaccuracies (such as `0.1 + 0.2 = 0.30000000000000004`), JavaScript floating-point numbers are strictly forbidden for authoritative financial math. All monetary columns in SQLite and runtime variables are stored as **integer minor units** (PKR Paisa / Cents):

$$\text{Paisa Minor Units} = \text{round}(\text{Decimal Currency} \times 10^{\text{currencyPrecision}})$$

### 1.1. Examples in Pakistani Rupees (PKR)
- $\text{Rs } 100.00 = 10,000 \text{ paisa}$
- $\text{Rs } 25.50 = 2,550 \text{ paisa}$
- $\text{Rs } 0.75 = 75 \text{ paisa}$

### 1.2. Precision & Rounding Policy
- System default currency precision is defined in `business_settings.currency_precision` (Default = 2 for PKR, scale factor = 100).
- Precision cannot be modified without a controlled database migration.
- Any decimal input that has fractional paisa beyond the configured precision scale is strictly **rejected** via `MoneyPrecisionError`. Quiet rounding is prohibited.

---

## 2. Fixed-Point Quantity Scale (`QUANTITY_SCALE = 10,000`)

Every physical product is maintained in inventory in its canonical base unit using a fixed-point scale factor:

$$\text{QUANTITY\_SCALE} = 10,000$$

A scaled value of $1$ represents $\frac{1}{10,000}\text{th}$ of a canonical base unit.

### 2.1. Scale Examples
- $1 \text{ piece} = 10,000 \text{ scaled units}$
- $1.5 \text{ kg} = 15,000 \text{ scaled kg units}$
- $0.250 \text{ kg} = 2,500 \text{ scaled kg units}$
- $2.75 \text{ litres} = 27,500 \text{ scaled litre units}$

### 2.2. Precision Scale Enforcement & Rejection Rule
The fixed-point scale represents numerical precision, not unit conversion. Each unit has a defined `precision_scale`:
- **Count / Piece**: `precision_scale = 0` (Only integer pieces allowed; $1.5$ pieces is rejected).
- **Weight / Kg**: `precision_scale = 3` (Up to 3 decimal places / grams allowed; $1.250$ kg is valid, $1.25055$ kg is rejected).
- **Scale Upper Limit**: No input quantity may exceed 4 decimal places ($\le \text{QUANTITY\_SCALE}$). Unrepresentable fractions are rejected with `InvalidQuantityPrecisionError`. Quiet rounding is prohibited.

---

## 3. Unit Definitions & Rational Multi-Unit Conversions

Packaging unit conversions are stored in `product_unit_conversions` as **exact rational numbers**:
$$\text{Conversion Ratio} = \frac{\text{base\_units\_numerator}}{\text{base\_units\_denominator}}$$

### 3.1. Standard & Dynamic Multi-Unit Rules
- **Dozen**: $\text{numerator} = 12, \; \text{denominator} = 1$
- **Gross**: $\text{numerator} = 144, \; \text{denominator} = 1$
- **Dynamic Pack (Product-Specific)**:
  - Product A (Shampoo): $\text{numerator} = 6, \; \text{denominator} = 1$ (Pack of 6)
  - Product B (Juice): $\text{numerator} = 12, \; \text{denominator} = 1$ (Pack of 12)
  - *Pack size is never assumed to be a global constant.*
- **Weight (Mass)**:
  - When base unit is Gram: $1 \text{ kg}$ has $\text{numerator} = 1,000, \; \text{denominator} = 1$.
  - A sale of $2.25 \text{ kg}$ chawal generates a stock ledger deduction of $2,250 \text{ grams}$ ($22,500,000 \text{ scaled units}$).

### 3.2. Stock Ledger Movement Formula
$$\text{Quantity Base Scaled} = \frac{\text{Quantity Scaled} \times \text{base\_units\_numerator}}{\text{base\_units\_denominator}}$$

**Example**:
- Initial stock: $10 \text{ gross} = 10 \times 144 = 1,440 \text{ pieces}$
- Sale: $2 \text{ dozen} = 2 \times 12 = 24 \text{ pieces}$
- Remaining balance: $1,440 - 24 = 1,416 \text{ pieces}$

### 3.3. Unit Pricing & Margin Formula
$$\text{Per-Base-Unit Cost} = \text{round}\left(\frac{\text{Package Purchase Cost} \times \text{base\_units\_denominator}}{\text{base\_units\_numerator}}\right)$$

**Example**:
- $1 \text{ dozen}$ purchased for $\text{Rs } 240.00$ ($24,000 \text{ paisa}$)
- $\text{Per-piece cost} = \frac{24,000}{12} = \text{Rs } 20.00$ ($2,000 \text{ paisa}$)
- Sale of $3 \text{ pieces}$ at $\text{Rs } 25.00$ each ($2,500 \text{ paisa}$):
  - $\text{Sale Total} = 3 \times 2,500 = \text{Rs } 75.00$ ($7,500 \text{ paisa}$)
  - $\text{COGS} = 3 \times 2,000 = \text{Rs } 60.00$ ($6,000 \text{ paisa}$)
  - $\text{Gross Profit} = 7,500 - 6,000 = \text{Rs } 15.00$ ($1,500 \text{ paisa}$)

---

## 4. Product Variants vs. Unit Conversions Distinction

- **Product Variants** (`product_variants`): Represent physically distinct inventory items (e.g., Running Shoes Size 40 Black vs. Size 41 Black). Each variant carries its own SKU, barcode, and separate stock ledger balance in `stock_balances`.
- **Unit Conversions** (`product_unit_conversions`): Represent packaging or volumetric ratios for measuring/selling a product (e.g., Piece, Dozen, Pack, Carton).
- Stock movements are strictly posted against `(product_id, variant_id)` in canonical base quantity.

---

## 5. Single Authoritative Sale Line Formula & Historical Snapshots

### 5.1. Line Calculation Sequence
1. **Line Gross**:
   $$\text{Line Gross} = \text{round}(\text{Quantity} \times \text{Unit Price})$$
2. **Line Item Discount**:
   $$\text{Item Discount} = \min\left(\text{Line Gross}, \; \text{round}\left(\frac{\text{Line Gross} \times \text{Discount } \%}{100}\right) + \text{Flat Discount}\right)$$
   $$\text{Line Net Before Bill Discount} = \text{Line Gross} - \text{Item Discount}$$
3. **Bill-Level Discount Apportionment**:
   $$\text{Allocated Bill Discount}_i = \text{round}\left(\frac{\text{Line Net Before Bill Discount}_i}{\sum \text{Line Net Before Bill Discount}} \times \text{Total Bill Discount}\right)$$
   *Conservation Rule*: The final line item absorbs any integer remainder so that:
   $$\sum_{i=1}^N \text{Allocated Bill Discount}_i \equiv \text{Total Bill Discount}$$
4. **Line Net After Bill Discount**:
   $$\text{Line Net} = \text{Line Net Before Bill Discount} - \text{Allocated Bill Discount}$$
5. **Tax Calculation**:
   - **Exclusive (`isTaxInclusive = false`)**:
     $$\text{Line Tax} = \text{round}\left(\frac{\text{Line Net} \times \text{Tax Rate}}{100}\right)$$
     $$\text{Line Total} = \text{Line Net} + \text{Line Tax}$$
     $$\text{Pre-Tax Revenue} = \text{Line Net}$$
   - **Inclusive (`isTaxInclusive = true`)**:
     $$\text{Pre-Tax Revenue} = \text{round}\left(\frac{\text{Line Net}}{1 + \frac{\text{Tax Rate}}{100}}\right)$$
     $$\text{Line Tax} = \text{Line Net} - \text{Pre-Tax Revenue}$$
     $$\text{Line Total} = \text{Line Net}$$
6. **Line Cost & Gross Profit**:
   $$\text{Line Cost} = \text{round}\left(\frac{\text{Base Quantity Scaled}}{\text{QUANTITY\_SCALE}} \times \text{Unit Cost Minor}\right)$$
   $$\text{Line Profit} = \text{Pre-Tax Revenue} - \text{Line Cost}$$

### 5.2. Example
- $\text{Quantity} = 3$
- $\text{Unit Price} = \text{Rs } 100.00$ ($10,000 \text{ paisa}$)
- $\text{Gross Line Total} = \text{Rs } 300.00$ ($30,000 \text{ paisa}$)
- $\text{Line Discount} = \text{Rs } 20.00$ ($2,000 \text{ paisa}$)
- $\text{Allocated Bill Discount} = \text{Rs } 10.00$ ($1,000 \text{ paisa}$)
- $\text{Tax} = \text{Rs } 0$ (disabled)
- $\text{Final Line Total} = 300 - 20 - 10 = \text{Rs } 270.00$ ($27,000 \text{ paisa}$)

### 5.3. Immutable Historical Snapshots
Every posted line permanently stores frozen historical snapshots in `sale_lines`:
- Product Name & SKU snapshot
- Variant Name snapshot
- Unit Name & Rational Multiplier snapshots (`conversion_numerator_snapshot`, `conversion_denominator_snapshot`)
- Quantity Scaled
- Unit Price, Line Discount, Allocated Bill Discount
- Tax Rate, Tax Amount, Tax Inclusive Flag
- Final Line Total
- Unit Cost snapshot (`unit_cost_minor`)
- Total Line Cost & Line Profit

---

## 6. Customer Account Statement Formula

Every customer ledger transaction computes an authoritative running balance chronologically:

$$\text{Running Balance}_t = \text{Running Balance}_{t-1} + \text{Debit}_t - \text{Credit}_t$$

### 6.1. Financial Events Breakdown
| Event | Debit | Credit | Running Balance Impact |
|---|---|---|---|
| **Credit Sale** | $\text{Unpaid Balance}$ | $0$ | Increases Customer Debt |
| **Cash Sale (Fully Paid)** | $0$ | $0$ | **No change to running balance** |
| **Partial Payment Credit Sale** | $\text{Total Sale} - \text{Paid Upfront}$ | $0$ | Only increases by the unpaid debt |
| **Payment Received / Receipt** | $0$ | $\text{Amount Paid}$ | Decreases Customer Debt |
| **Sale Return / Credit Note** | $0$ | $\text{Refund Amount}$ | Decreases Customer Debt |

### 6.2. Document Linking
Each statement entry provides an actionable navigation link (`Open Bill` or `Open Transaction`) pointing directly to the underlying invoice or payment voucher.

---

## 7. Cash Register Drawer Closing Formula

The physical cash drawer balance is reconciled strictly from cash-affecting transactions:

$$\begin{aligned}
\text{Expected Cash} = & \;\; \text{Opening Cash} \\
& + \text{Cash Sales Received} \\
& + \text{Customer Payments Received in Cash} \\
& + \text{Authorized Cash-In} \\
& - \text{Cash Refunds} \\
& - \text{Cash Expenses} \\
& - \text{Cash Paid to Suppliers} \\
& - \text{Authorized Cash-Out}
\end{aligned}$$

### 7.1. Strict Physical Separation Rule
Non-cash payment methods (**Bank Transfer**, **Credit/Debit Card**, **JazzCash**, **Easypaisa**, **Raast**) never enter the till drawer and are strictly **excluded** from `Expected Cash`. They are tracked in separate non-cash audit totals.

### 7.2. Audit Discrepancy
$$\text{Discrepancy} = \text{Actual Counted Cash} - \text{Expected Cash}$$
- $\text{Discrepancy} = 0 \implies \text{BALANCED}$
- $\text{Discrepancy} < 0 \implies \text{SHORTAGE (Deficit)}$
- $\text{Discrepancy} > 0 \implies \text{OVERAGE (Surplus)}$

---

## 8. Moving Weighted-Average Cost (MAC) & Retail Profit

### 8.1. MAC Stock Intake Formula
When new stock is received into inventory:

$$\text{New Cost Minor} = \text{round}\left(\frac{(\text{Current Qty} \times \text{Current Cost Minor}) + (\text{Received Qty} \times \text{Purchase Cost Minor})}{\text{Current Qty} + \text{Received Qty}}\right)$$

If current stock $\le 0$, the incoming purchase cost becomes the new base unit cost.

### 8.2. Historical Sale Cost Immutability Rule
Updating the product's moving-average cost in inventory **NEVER** rewrites or recalculates historical sale line costs (`sale_lines.unit_cost_minor`). Historical margins remain permanently frozen as originally posted.

### 8.3. Statutory Sales Tax Treatment & Profit Separation
Sales tax collected is a fiduciary liability owed to the government, not commercial sales revenue:
$$\text{Net Revenue Ex Tax} = \text{Gross Sales} - \text{Discounts Allowed} - \text{Sales Tax Collected}$$
$$\text{Gross Profit} = \text{Net Revenue Ex Tax} - \text{Cost of Goods Sold (COGS)}$$
$$\text{Operating Profit} = \text{Gross Profit} - \text{Total Operating Expenses}$$

Gross Profit and Operating Profit are published as two distinct, independent accounting reports.

### 7.1. Strict Physical Separation Rule
Non-cash payment methods (**Bank Transfer**, **Credit/Debit Card**, **JazzCash**, **Easypaisa**, **Raast**) never enter the till drawer and are strictly **excluded** from `Expected Cash`. They are tracked in separate non-cash audit totals.

### 7.2. Audit Discrepancy
$$\text{Discrepancy} = \text{Actual Counted Cash} - \text{Expected Cash}$$
- $\text{Discrepancy} = 0 \implies \text{BALANCED}$
- $\text{Discrepancy} < 0 \implies \text{SHORTAGE (Deficit)}$
- $\text{Discrepancy} > 0 \implies \text{OVERAGE (Surplus)}$

---

## 8. Moving Weighted-Average Cost (MAC) & Retail Profit

### 8.1. MAC Stock Intake Formula
When new stock is received into inventory:

$$\text{New Cost Minor} = \text{round}\left(\frac{(\text{Current Qty} \times \text{Current Cost Minor}) + (\text{Received Qty} \times \text{Purchase Cost Minor})}{\text{Current Qty} + \text{Received Qty}}\right)$$

If current stock $\le 0$, the incoming purchase cost becomes the new base unit cost.

### 8.2. Historical Sale Cost Immutability Rule
Updating the product's moving-average cost in inventory **NEVER** rewrites or recalculates historical sale line costs (`sale_lines.unit_cost_minor`). Historical margins remain permanently frozen as originally posted.

### 8.3. Statutory Sales Tax Treatment & Profit Separation
Sales tax collected is a fiduciary liability owed to the government, not commercial sales revenue:
$$\text{Net Revenue Ex Tax} = \text{Gross Sales} - \text{Discounts Allowed} - \text{Sales Tax Collected}$$
$$\text{Gross Profit} = \text{Net Revenue Ex Tax} - \text{Cost of Goods Sold (COGS)}$$
$$\text{Operating Profit} = \text{Gross Profit} - \text{Total Operating Expenses}$$

Gross Profit and Operating Profit are published as two distinct, independent accounting reports.

