import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../state/AuthContext';
import {
  Search,
  Barcode,
  Trash2,
  Plus,
  Minus,
  CreditCard,
  Banknote,
  Receipt,
  User,
  Percent,
  CheckCircle2,
  Printer,
  X
} from 'lucide-react';
import { Product, Customer, CartItemInput, SaleCalculationResult, Sale } from '../../../shared/types';
import { PaymentMethod } from '../../../shared/constants/accounts';

export const SalesPage: React.FC = () => {
  const { user } = useAuth();
  const [barcodeInput, setBarcodeInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | undefined>(1); // Default to Walk-in (id=1)
  const [cart, setCart] = useState<CartItemInput[]>([]);
  const [orderDiscountPercent, setOrderDiscountPercent] = useState<number>(0);
  const [calculation, setCalculation] = useState<SaleCalculationResult | null>(null);
  
  // Checkout Modal state
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [amountPaidInput, setAmountPaidInput] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const barcodeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Load customer directory
    async function loadCustomers() {
      if (window.posApi?.customers) {
        const list = await window.posApi.customers.list();
        setCustomers(list);
      }
    }
    loadCustomers();
    barcodeRef.current?.focus();
  }, []);

  // Whenever cart or order discount changes, trigger Domain calculation preview via IPC
  useEffect(() => {
    async function recalculate() {
      if (cart.length === 0) {
        setCalculation(null);
        return;
      }
      try {
        if (window.posApi?.sales) {
          const result = await window.posApi.sales.calculate(cart, orderDiscountPercent, 0);
          setCalculation(result);
        }
      } catch (err) {
        console.error('Failed to calculate sale preview:', err);
      }
    }
    recalculate();
  }, [cart, orderDiscountPercent]);

  // Handle barcode submission
  const handleBarcodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;

    try {
      if (window.posApi?.inventory) {
        const product = await window.posApi.inventory.getProductByBarcode(barcodeInput.trim());
        if (product) {
          addToCart(product);
          setBarcodeInput('');
        } else {
          setErrorMsg(`No product found for barcode: ${barcodeInput}`);
          setTimeout(() => setErrorMsg(null), 3000);
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  // Handle product search
  const handleSearchChange = async (query: string) => {
    setSearchQuery(query);
    if (query.trim().length > 1 && window.posApi?.inventory) {
      const results = await window.posApi.inventory.searchProducts(query);
      setSearchResults(results);
    } else {
      setSearchResults([]);
    }
  };

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existingIndex = prev.findIndex((item) => item.productId === product.id);
      if (existingIndex > -1) {
        const updated = [...prev];
        updated[existingIndex].quantity += 1;
        return updated;
      } else {
        return [
          ...prev,
          {
            productId: product.id,
            unitName: product.baseUnit,
            quantity: 1,
            conversionFactor: 1,
            unitPrice: product.sellingPrice,
            costPrice: product.costPrice,
            discountPercent: 0,
            discountAmount: 0,
            taxRate: product.taxRate,
            isTaxInclusive: product.isTaxInclusive
          }
        ];
      }
    });
    setSearchQuery('');
    setSearchResults([]);
    barcodeRef.current?.focus();
  };

  const updateQuantity = (productId: number | string, delta: number) => {
    setCart((prev) => {
      return prev
        .map((item) => {
          if (item.productId === productId) {
            const newQty = item.quantity + delta;
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItemInput[];
    });
  };

  const removeItem = (productId: number | string) => {
    setCart((prev) => prev.filter((item) => item.productId !== productId));
  };

  const clearCart = () => {
    setCart([]);
    setCalculation(null);
    setOrderDiscountPercent(0);
    barcodeRef.current?.focus();
  };

  const openCheckout = () => {
    if (!calculation || calculation.grandTotal <= 0) return;
    setAmountPaidInput((calculation.grandTotal / 100).toFixed(2));
    setIsCheckoutOpen(true);
  };

  const handleCompleteSale = async () => {
    if (!calculation) return;
    setIsProcessing(true);
    setErrorMsg(null);

    try {
      const amountPaidCents = Math.round(parseFloat(amountPaidInput || '0') * 100);

      const request = {
        customerId: selectedCustomerId,
        cashierId: user?.id || 1,
        items: cart,
        orderDiscountPercent,
        paymentMethod,
        amountPaid: amountPaidCents
      };

      const sale = await window.posApi.sales.createSale(request);
      setCompletedSale(sale);
      setIsCheckoutOpen(false);
      clearCart();

      // Trigger automatic silent receipt print if configured
      if (window.posApi?.printing) {
        window.posApi.printing.printReceipt(sale).catch((e) => console.warn('Receipt print skipped:', e));
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to process sale');
    } finally {
      setIsProcessing(false);
    }
  };

  const formatCents = (cents: number) => `Rs. ${(cents / 100).toFixed(2)}`;

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left Area: POS Cart & Scanner */}
      <div className="flex-1 flex flex-col border-r border-slate-800 bg-slate-950">
        {/* Barcode & Search Bar */}
        <div className="p-4 bg-slate-900 border-b border-slate-800 flex items-center gap-3">
          {/* Barcode scanner form */}
          <form onSubmit={handleBarcodeSubmit} className="flex-1 relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
              <Barcode className="w-5 h-5 text-blue-400" />
            </div>
            <input
              ref={barcodeRef}
              type="text"
              placeholder="Scan Barcode or Enter SKU (Press Enter)..."
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-white placeholder-slate-500 font-mono text-sm focus:outline-none focus:border-blue-500 transition"
            />
          </form>

          {/* Product Name Search */}
          <div className="relative w-72">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
              <Search className="w-4 h-4" />
            </div>
            <input
              type="text"
              placeholder="Search product name..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500 transition"
            />

            {searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl max-h-60 overflow-y-auto z-30">
                {searchResults.map((product) => (
                  <div
                    key={product.id}
                    onClick={() => addToCart(product)}
                    className="p-3 hover:bg-slate-700/70 cursor-pointer border-b border-slate-700/50 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-semibold text-sm text-white">{product.name}</div>
                      <div className="text-xs text-slate-400">Stock: {product.currentStock} {product.baseUnit}</div>
                    </div>
                    <div className="text-sm font-mono text-emerald-400 font-bold">
                      {formatCents(product.sellingPrice)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {errorMsg && (
          <div className="mx-4 mt-3 p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl">
            {errorMsg}
          </div>
        )}

        {/* Cart Items Table */}
        <div className="flex-1 overflow-y-auto p-4">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500">
              <Barcode className="w-16 h-16 mb-3 text-slate-700 stroke-1" />
              <div className="text-lg font-medium text-slate-400">Cart is Empty</div>
              <p className="text-xs text-slate-500 mt-1">Scan a barcode or use product search to begin</p>
            </div>
          ) : (
            <div className="space-y-2">
              {calculation?.items.map((item) => (
                <div
                  key={item.productId}
                  className="bg-slate-900 border border-slate-800/80 rounded-xl p-3 flex items-center justify-between hover:border-slate-700 transition"
                >
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="font-semibold text-sm text-white truncate">
                      Product #{item.productId}
                    </div>
                    <div className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                      <span>{formatCents(item.unitPrice)} / {item.unitName}</span>
                      {(item.taxRate ?? 0) > 0 && (
                        <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">
                          +{item.taxRate}% Tax
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Quantity controls */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateQuantity(item.productId, -1)}
                      className="w-7 h-7 bg-slate-800 hover:bg-slate-700 rounded-lg flex items-center justify-center text-slate-300 transition"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="w-10 text-center font-mono font-bold text-sm text-white">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => updateQuantity(item.productId, 1)}
                      className="w-7 h-7 bg-slate-800 hover:bg-slate-700 rounded-lg flex items-center justify-center text-slate-300 transition"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Line Total */}
                  <div className="w-28 text-right font-mono font-bold text-sm text-emerald-400">
                    {formatCents(item.lineTotal)}
                  </div>

                  {/* Remove Button */}
                  <button
                    onClick={() => removeItem(item.productId)}
                    className="ml-3 p-1.5 text-slate-500 hover:text-red-400 rounded-lg hover:bg-slate-800 transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right Area: Order Summary & Checkout Panel */}
      <div className="w-96 bg-slate-900 border-l border-slate-800 flex flex-col shrink-0">
        {/* Customer Selector */}
        <div className="p-4 border-b border-slate-800">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
            Customer Account
          </label>
          <div className="relative">
            <select
              value={selectedCustomerId || ''}
              onChange={(e) => setSelectedCustomerId(Number(e.target.value) || undefined)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.phone})
                </option>
              ))}
            </select>
          </div>

          {selectedCustomer && selectedCustomer.id !== 1 && (
            <div className="mt-2 p-2 rounded-lg bg-slate-950/60 border border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-400">Current Balance:</span>
              <span className={`font-mono font-bold ${selectedCustomer.balance > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {formatCents(selectedCustomer.balance)}
              </span>
            </div>
          )}
        </div>

        {/* Calculations breakdown */}
        <div className="p-5 flex-1 space-y-3">
          <div className="flex justify-between text-sm text-slate-400">
            <span>Subtotal</span>
            <span className="font-mono text-white">
              {formatCents(calculation?.subtotal || 0)}
            </span>
          </div>

          <div className="flex justify-between items-center text-sm text-slate-400">
            <span className="flex items-center gap-1">
              <Percent className="w-3.5 h-3.5" /> Order Discount
            </span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                max="100"
                value={orderDiscountPercent}
                onChange={(e) => setOrderDiscountPercent(Number(e.target.value))}
                className="w-16 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-right text-xs text-white"
              />
              <span className="text-xs">%</span>
            </div>
          </div>

          {calculation && calculation.totalDiscount > 0 && (
            <div className="flex justify-between text-sm text-emerald-400">
              <span>Total Discount</span>
              <span className="font-mono">-{formatCents(calculation.totalDiscount)}</span>
            </div>
          )}

          <div className="flex justify-between text-sm text-slate-400">
            <span>Sales Tax</span>
            <span className="font-mono text-white">
              {formatCents(calculation?.totalTax || 0)}
            </span>
          </div>

          <div className="border-t border-slate-800 my-3 pt-3">
            <div className="flex justify-between items-baseline">
              <span className="text-base font-bold text-white">Grand Total</span>
              <span className="text-2xl font-black font-mono text-emerald-400">
                {formatCents(calculation?.grandTotal || 0)}
              </span>
            </div>
          </div>
        </div>

        {/* Actions Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/50 space-y-2">
          <button
            onClick={openCheckout}
            disabled={!calculation || calculation.grandTotal <= 0}
            className="w-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white font-bold py-3.5 rounded-xl transition duration-150 flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 text-base"
          >
            <Banknote className="w-5 h-5" />
            <span>Charge {formatCents(calculation?.grandTotal || 0)}</span>
          </button>

          <button
            onClick={clearCart}
            disabled={cart.length === 0}
            className="w-full bg-slate-800 hover:bg-slate-700/80 disabled:opacity-40 text-slate-400 hover:text-slate-200 text-xs font-semibold py-2.5 rounded-xl transition flex items-center justify-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Void / Clear Cart</span>
          </button>
        </div>
      </div>

      {/* Checkout Modal */}
      {isCheckoutOpen && calculation && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-5">
              <h3 className="text-lg font-bold text-white">Complete Transaction</h3>
              <button
                onClick={() => setIsCheckoutOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Payment Method Selector */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              {[
                { id: PaymentMethod.CASH, label: 'Cash', icon: Banknote },
                { id: PaymentMethod.CARD, label: 'Card', icon: CreditCard },
                { id: PaymentMethod.CREDIT, label: 'On Account', icon: User }
              ].map((m) => {
                const Icon = m.icon;
                const isSelected = paymentMethod === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setPaymentMethod(m.id)}
                    className={`p-3 rounded-xl border flex flex-col items-center gap-2 transition ${
                      isSelected
                        ? 'bg-blue-600/20 border-blue-500 text-white font-bold'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-xs">{m.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Amount Paid input */}
            <div className="mb-5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
                Amount Tendered
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500 font-mono text-sm">
                  Rs.
                </span>
                <input
                  type="number"
                  step="0.01"
                  value={amountPaidInput}
                  onChange={(e) => setAmountPaidInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-4 py-3 text-xl font-bold font-mono text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* Quick cash denomination buttons */}
            {paymentMethod === PaymentMethod.CASH && (
              <div className="grid grid-cols-4 gap-2 mb-5">
                {[100, 500, 1000, 5000].map((val) => (
                  <button
                    key={val}
                    onClick={() => setAmountPaidInput(val.toString())}
                    className="p-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-mono font-semibold text-slate-200"
                  >
                    +Rs. {val}
                  </button>
                ))}
              </div>
            )}

            {/* Change or Customer balance preview */}
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl mb-6">
              <div className="flex justify-between text-sm text-slate-400 mb-1">
                <span>Grand Total:</span>
                <span className="font-mono text-white font-bold">{formatCents(calculation.grandTotal)}</span>
              </div>
              {parseFloat(amountPaidInput || '0') * 100 >= calculation.grandTotal ? (
                <div className="flex justify-between text-base text-emerald-400 font-bold">
                  <span>Change Due:</span>
                  <span className="font-mono">
                    {formatCents(Math.round(parseFloat(amountPaidInput || '0') * 100) - calculation.grandTotal)}
                  </span>
                </div>
              ) : (
                <div className="flex justify-between text-base text-amber-400 font-bold">
                  <span>Balance (Added to dues):</span>
                  <span className="font-mono">
                    {formatCents(calculation.grandTotal - Math.round(parseFloat(amountPaidInput || '0') * 100))}
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={handleCompleteSale}
              disabled={isProcessing}
              className="w-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-white font-bold py-3.5 rounded-xl transition duration-150 flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20"
            >
              <CheckCircle2 className="w-5 h-5" />
              <span>{isProcessing ? 'Recording Sale...' : 'Confirm & Print Receipt'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Sale Success / Receipt Modal */}
      {completedSale && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-sm rounded-2xl p-6 text-center shadow-2xl">
            <div className="w-14 h-14 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-white mb-1">Sale Completed!</h3>
            <p className="text-xs text-slate-400 mb-4 font-mono">Invoice #{completedSale.invoiceNumber}</p>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-left text-xs space-y-2 mb-5">
              <div className="flex justify-between">
                <span className="text-slate-400">Grand Total:</span>
                <span className="font-mono text-white font-bold">{formatCents(completedSale.grandTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Amount Paid:</span>
                <span className="font-mono text-white">{formatCents(completedSale.amountPaid)}</span>
              </div>
              {completedSale.changeGiven > 0 && (
                <div className="flex justify-between text-emerald-400 font-bold">
                  <span>Change Given:</span>
                  <span className="font-mono">{formatCents(completedSale.changeGiven)}</span>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (window.posApi?.printing) {
                    window.posApi.printing.printReceipt(completedSale);
                  }
                }}
                className="flex-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 transition"
              >
                <Printer className="w-4 h-4" /> Reprint
              </button>
              <button
                onClick={() => setCompletedSale(null)}
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 rounded-xl text-xs transition"
              >
                Next Sale
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

