import React, { useState, useEffect } from 'react';
import { Product, StockMovementType } from '../../../shared/types';
import { Search, Plus, AlertTriangle, Edit3, ArrowUpDown, RefreshCw, X, Check } from 'lucide-react';

export const InventoryPage: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Array<{ id: number; name: string }>>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // Modal state
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Form states
  const [formData, setFormData] = useState({
    id: undefined as number | undefined,
    name: '',
    categoryId: 1,
    sku: '',
    barcode: '',
    baseUnit: 'Piece',
    costPriceDecimal: '0',
    sellingPriceDecimal: '0',
    minStockLevel: 5,
    taxRate: 0,
    isTaxInclusive: true
  });

  const [adjustData, setAdjustData] = useState({
    movementType: StockMovementType.ADJUSTMENT_ADD,
    quantity: 1,
    reason: ''
  });

  const loadData = async () => {
    try {
      setLoading(true);
      if (window.posApi?.inventory) {
        const [prodList, catList] = await Promise.all([
          window.posApi.inventory.listProducts(),
          window.posApi.inventory.listCategories()
        ]);
        setProducts(prodList);
        setCategories(catList);
      }
    } catch (err) {
      console.error('Failed to load inventory data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openAddModal = () => {
    const timestamp = Date.now().toString().slice(-6);
    setFormData({
      id: undefined,
      name: '',
      categoryId: categories[0]?.id || 1,
      sku: `SKU-${timestamp}`,
      barcode: `890${timestamp}`,
      baseUnit: 'Piece',
      costPriceDecimal: '0.00',
      sellingPriceDecimal: '0.00',
      minStockLevel: 5,
      taxRate: 0,
      isTaxInclusive: true
    });
    setIsProductModalOpen(true);
  };

  const openEditModal = (p: Product) => {
    setFormData({
      id: p.id,
      name: p.name,
      categoryId: p.categoryId,
      sku: p.sku,
      barcode: p.barcode,
      baseUnit: p.baseUnit,
      costPriceDecimal: (p.costPrice / 100).toFixed(2),
      sellingPriceDecimal: (p.sellingPrice / 100).toFixed(2),
      minStockLevel: p.minStockLevel,
      taxRate: p.taxRate,
      isTaxInclusive: p.isTaxInclusive
    });
    setIsProductModalOpen(true);
  };

  const openAdjustModal = (p: Product) => {
    setSelectedProduct(p);
    setAdjustData({
      movementType: StockMovementType.ADJUSTMENT_ADD,
      quantity: 1,
      reason: 'Physical stock reconciliation'
    });
    setIsAdjustModalOpen(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        id: formData.id,
        name: formData.name,
        categoryId: Number(formData.categoryId),
        sku: formData.sku,
        barcode: formData.barcode,
        baseUnit: formData.baseUnit,
        costPrice: Math.round(parseFloat(formData.costPriceDecimal || '0') * 100),
        sellingPrice: Math.round(parseFloat(formData.sellingPriceDecimal || '0') * 100),
        currentStock: 0,
        minStockLevel: Number(formData.minStockLevel),
        taxRate: Number(formData.taxRate),
        isTaxInclusive: formData.isTaxInclusive,
        isActive: true
      };

      await window.posApi.inventory.saveProduct(payload);
      setIsProductModalOpen(false);
      loadData();
    } catch (err: any) {
      alert(`Error saving product: ${err.message}`);
    }
  };

  const handleStockAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) return;
    try {
      await window.posApi.inventory.adjustStock({
        productId: selectedProduct.id,
        movementType: adjustData.movementType,
        quantity: Number(adjustData.quantity),
        reason: adjustData.reason,
        userId: 1
      });
      setIsAdjustModalOpen(false);
      loadData();
    } catch (err: any) {
      alert(`Adjustment error: ${err.message}`);
    }
  };

  const filteredProducts = products.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.barcode.includes(searchQuery) ||
    p.sku.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatCents = (cents: number) => `Rs. ${(cents / 100).toFixed(2)}`;

  return (
    <div className="flex-1 p-6 flex flex-col overflow-hidden">
      {/* Top action bar */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-xl font-bold text-white">Inventory & Products</h1>
          <p className="text-xs text-slate-400">Total catalog: {products.length} items</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <button
            onClick={openAddModal}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl transition shadow-md shadow-blue-600/20"
          >
            <Plus className="w-4 h-4" /> Add Product
          </button>

          <button
            onClick={loadData}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Products Table */}
      <div className="flex-1 overflow-y-auto mt-4 rounded-xl border border-slate-800 bg-slate-900/60">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900 text-slate-400 font-semibold border-b border-slate-800 sticky top-0">
            <tr>
              <th className="p-3">Product Name</th>
              <th className="p-3">Barcode / SKU</th>
              <th className="p-3">Category</th>
              <th className="p-3 text-right">Cost Price</th>
              <th className="p-3 text-right">Selling Price</th>
              <th className="p-3 text-center">In Stock</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {filteredProducts.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-500">
                  No products found. Click "Add Product" to create your first item.
                </td>
              </tr>
            ) : (
              filteredProducts.map((p) => {
                const isLow = p.currentStock <= p.minStockLevel;
                return (
                  <tr key={p.id} className="hover:bg-slate-800/40 transition">
                    <td className="p-3 font-semibold text-white">
                      <div>{p.name}</div>
                      <div className="text-[10px] text-slate-400">{p.baseUnit}</div>
                    </td>
                    <td className="p-3 font-mono text-slate-300">
                      <div>{p.barcode}</div>
                      <div className="text-[10px] text-slate-500">{p.sku}</div>
                    </td>
                    <td className="p-3 text-slate-300">{p.categoryName || 'General'}</td>
                    <td className="p-3 text-right font-mono text-slate-400">{formatCents(p.costPrice)}</td>
                    <td className="p-3 text-right font-mono font-bold text-emerald-400">{formatCents(p.sellingPrice)}</td>
                    <td className="p-3 text-center">
                      <span className={`inline-flex items-center gap-1 font-mono font-bold px-2 py-0.5 rounded-full text-xs ${
                        isLow ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' : 'text-slate-200'
                      }`}>
                        {isLow && <AlertTriangle className="w-3 h-3" />}
                        {p.currentStock}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => openAdjustModal(p)}
                          title="Adjust Stock"
                          className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-blue-400 rounded-lg transition"
                        >
                          <ArrowUpDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => openEditModal(p)}
                          title="Edit Product"
                          className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg transition"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Add / Edit Product Modal */}
      {isProductModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-2xl p-6 shadow-2xl">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800 mb-4">
              <h3 className="text-base font-bold text-white">
                {formData.id ? 'Edit Product' : 'Add New Product'}
              </h3>
              <button onClick={() => setIsProductModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Product Name</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  placeholder="e.g. Fresh Milk 1L"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Barcode</label>
                  <input
                    type="text"
                    required
                    value={formData.barcode}
                    onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">SKU</label>
                  <input
                    type="text"
                    required
                    value={formData.sku}
                    onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Category</label>
                  <select
                    value={formData.categoryId}
                    onChange={(e) => setFormData({ ...formData, categoryId: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Base Packaging Unit</label>
                  <input
                    type="text"
                    value={formData.baseUnit}
                    onChange={(e) => setFormData({ ...formData, baseUnit: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                    placeholder="Piece, Box, Kg, etc."
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Cost Price (Rs.)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={formData.costPriceDecimal}
                    onChange={(e) => setFormData({ ...formData, costPriceDecimal: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Selling Retail Price (Rs.)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={formData.sellingPriceDecimal}
                    onChange={(e) => setFormData({ ...formData, sellingPriceDecimal: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono font-bold text-emerald-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Low Stock Alert Level</label>
                  <input
                    type="number"
                    value={formData.minStockLevel}
                    onChange={(e) => setFormData({ ...formData, minStockLevel: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Tax Rate (%)</label>
                  <input
                    type="number"
                    value={formData.taxRate}
                    onChange={(e) => setFormData({ ...formData, taxRate: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 rounded-xl transition mt-4"
              >
                Save Product
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {isAdjustModalOpen && selectedProduct && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-2xl p-6 shadow-2xl">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800 mb-4">
              <div>
                <h3 className="text-base font-bold text-white">Adjust Stock Level</h3>
                <p className="text-xs text-slate-400">{selectedProduct.name} (Current: {selectedProduct.currentStock})</p>
              </div>
              <button onClick={() => setIsAdjustModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleStockAdjustment} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Adjustment Type</label>
                <select
                  value={adjustData.movementType}
                  onChange={(e) => setAdjustData({ ...adjustData, movementType: e.target.value as StockMovementType })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                >
                  <option value={StockMovementType.ADJUSTMENT_ADD}>Stock Count Increase (+)</option>
                  <option value={StockMovementType.ADJUSTMENT_DAMAGE}>Damaged Goods (-)</option>
                  <option value={StockMovementType.ADJUSTMENT_THEFT}>Lost / Theft Goods (-)</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Quantity ({selectedProduct.baseUnit})</label>
                <input
                  type="number"
                  min="1"
                  required
                  value={adjustData.quantity}
                  onChange={(e) => setAdjustData({ ...adjustData, quantity: Number(e.target.value) })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Reason / Notes</label>
                <input
                  type="text"
                  required
                  value={adjustData.reason}
                  onChange={(e) => setAdjustData({ ...adjustData, reason: e.target.value })}
                  placeholder="e.g. Month-end physical stock audit"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <button
                type="submit"
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2.5 rounded-xl transition mt-4"
              >
                Apply Adjustment
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

