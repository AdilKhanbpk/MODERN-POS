import React, { useState, useEffect } from 'react';
import { PurchaseOrder as LegacyPurchaseOrder, Supplier, Product } from '../../../shared/types';
import { Truck, Plus, RefreshCw, X, PackagePlus, FileText, ShoppingBag, PackageCheck } from 'lucide-react';
import { PurchaseOrdersView } from '../../components/purchase/PurchaseOrdersView';
import { GoodsReceiptsView } from '../../components/receiving/GoodsReceiptsView';

export const PurchasesPage: React.FC = () => {
  const [tab, setTab] = useState<'orders' | 'grn' | 'direct'>('orders');
  const [purchases, setPurchases] = useState<LegacyPurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form
  const [selectedSupplierId, setSelectedSupplierId] = useState<number>(1);
  const [invoiceNumber, setInvoiceNumber] = useState(`PO-${Date.now().toString().slice(-6)}`);
  const [selectedProductId, setSelectedProductId] = useState<number>(1);
  const [quantity, setQuantity] = useState<number>(10);
  const [unitCost, setUnitCost] = useState<string>('50.00');
  const [sellingPrice, setSellingPrice] = useState<string>('70.00');
  const [freightCost, setFreightCost] = useState<string>('0.00');
  const [amountPaid, setAmountPaid] = useState<string>('0.00');

  const loadData = async () => {
    try {
      setLoading(true);
      if (window.posApi) {
        const [poList, supList, prodList] = await Promise.all([
          window.posApi.purchases.list(),
          window.posApi.suppliers.list(),
          window.posApi.inventory.listProducts()
        ]);
        setPurchases(poList);
        setSuppliers(supList);
        setProducts(prodList);
        if (supList.length > 0) setSelectedSupplierId(supList[0].id);
        if (prodList.length > 0) setSelectedProductId(prodList[0].id);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreatePO = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const prod = products.find(p => p.id === selectedProductId);
      const unitCostCents = Math.round(parseFloat(unitCost) * 100);
      const sellingPriceCents = Math.round(parseFloat(sellingPrice) * 100);
      const freightCents = Math.round(parseFloat(freightCost) * 100);
      const amountPaidCents = Math.round(parseFloat(amountPaid) * 100);

      await window.posApi.purchases.create({
        supplierId: selectedSupplierId,
        invoiceNumber,
        additionalCost: freightCents,
        amountPaid: amountPaidCents,
        items: [
          {
            productId: selectedProductId,
            unitName: prod ? prod.baseUnit : 'Piece',
            quantity,
            conversionFactor: 1,
            unitCostPrice: unitCostCents,
            sellingPrice: sellingPriceCents,
            lineTotal: quantity * unitCostCents
          }
        ]
      });

      setIsModalOpen(false);
      loadData();
    } catch (err: any) {
      alert(`Error creating PO: ${err.message}`);
    }
  };

  const formatCents = (cents: number) => `Rs. ${(cents / 100).toFixed(2)}`;

  return (
    <div className="flex-1 p-6 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-xl font-bold text-white">Procurement & Purchases</h1>
          <p className="text-xs text-slate-400">Inbound purchase orders, multi-step approvals, goods receiving, and supplier billing</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1 gap-1">
            <button
              onClick={() => setTab('orders')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                tab === 'orders'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Purchase Orders</span>
            </button>
            <button
              onClick={() => setTab('grn')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                tab === 'grn'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <PackageCheck className="w-3.5 h-3.5" />
              <span>Goods Receipts (GRN)</span>
            </button>
            <button
              onClick={() => setTab('direct')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                tab === 'direct'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <PackagePlus className="w-3.5 h-3.5" />
              <span>Direct Bill Receiving</span>
            </button>
          </div>

          {tab === 'direct' && (
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setInvoiceNumber(`PO-${Date.now().toString().slice(-6)}`);
                  setIsModalOpen(true);
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl transition"
              >
                <Plus className="w-4 h-4" /> Receive Purchase
              </button>
              <button
                onClick={loadData}
                className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          )}
        </div>
      </div>

      {tab === 'orders' ? (
        <div className="flex-1 overflow-hidden mt-2">
          <PurchaseOrdersView />
        </div>
      ) : tab === 'grn' ? (
        <div className="flex-1 overflow-hidden mt-2">
          <GoodsReceiptsView />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto mt-4 rounded-xl border border-slate-800 bg-slate-900/60">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900 text-slate-400 font-semibold border-b border-slate-800 sticky top-0">
              <tr>
                <th className="p-3">PO / Bill #</th>
                <th className="p-3">Supplier</th>
                <th className="p-3 text-right">Subtotal</th>
                <th className="p-3 text-right">Freight / Landed</th>
                <th className="p-3 text-right">Grand Total</th>
                <th className="p-3 text-right">Amount Paid</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {purchases.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500">
                    No purchases recorded. Click "Receive Purchase" to add your first supplier bill.
                  </td>
                </tr>
              ) : (
                purchases.map((po) => (
                  <tr key={po.id} className="hover:bg-slate-800/40 transition">
                    <td className="p-3 font-mono font-bold text-white">{po.invoiceNumber}</td>
                    <td className="p-3 text-slate-300">{po.supplierName || 'General Supplier'}</td>
                    <td className="p-3 text-right font-mono text-slate-400">{formatCents(po.subtotal)}</td>
                    <td className="p-3 text-right font-mono text-slate-400">{formatCents(po.additionalCost)}</td>
                    <td className="p-3 text-right font-mono font-bold text-emerald-400">{formatCents(po.grandTotal)}</td>
                    <td className="p-3 text-right font-mono text-slate-300">{formatCents(po.amountPaid)}</td>
                    <td className="p-3 text-center">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                        {po.status}
                      </span>
                    </td>
                    <td className="p-3 text-slate-400 font-mono text-[11px]">{new Date(po.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Receive Purchase Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-2xl p-6 shadow-2xl">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800 mb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <PackagePlus className="w-5 h-5 text-blue-400" />
                <span>Receive Inventory Bill</span>
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreatePO} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Supplier</label>
                  <select
                    value={selectedSupplierId}
                    onChange={(e) => setSelectedSupplierId(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  >
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Supplier Bill #</label>
                  <input
                    type="text"
                    required
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Product</label>
                <select
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                >
                  {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.barcode})</option>)}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Quantity</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Unit Cost (Rs.)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={unitCost}
                    onChange={(e) => setUnitCost(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Retail Price (Rs.)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={sellingPrice}
                    onChange={(e) => setSellingPrice(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono text-emerald-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Landed Freight / Duty (Rs.)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={freightCost}
                    onChange={(e) => setFreightCost(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Cash Paid (Rs.)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={amountPaid}
                    onChange={(e) => setAmountPaid(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 rounded-xl transition mt-4"
              >
                Confirm & Stock In
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

