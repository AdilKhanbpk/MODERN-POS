import React, { useState, useEffect } from 'react';
import {
  X, Check, ChevronDown, ChevronRight, Copy, Archive, History,
  DollarSign, Package, Tag, Shield, HelpCircle, Layers, Plus, Trash2
} from 'lucide-react';
import { CatalogueProduct, ProductType, CostMethod } from '../../../shared/types/product-catalogue';

export interface ProductFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  product?: CatalogueProduct | null;
  businessId: string;
  onSaved: (product: any, keepOpenForNew?: boolean) => void;
  categories: Array<{ id: string; name: string }>;
  brands: Array<{ id: string; name: string }>;
  units: Array<{ id: string | number; name: string; symbol: string }>;
}

export const ProductFormModal: React.FC<ProductFormModalProps> = ({
  isOpen,
  onClose,
  product,
  businessId,
  onSaved,
  categories,
  brands,
  units
}) => {
  // Collapsible section state
  const [sectionPricing, setSectionPricing] = useState(true);
  const [sectionInventory, setSectionInventory] = useState(false);
  const [sectionAttributes, setSectionAttributes] = useState(false);

  // Form fields
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [productType, setProductType] = useState<ProductType>('standard');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [baseUnitId, setBaseUnitId] = useState<string | number>(1);
  const [defaultSaleUnitId, setDefaultSaleUnitId] = useState<string | number>(1);
  const [defaultPurchaseUnitId, setDefaultPurchaseUnitId] = useState<string | number>(1);

  // Pricing & Tax
  const [purchaseCost, setPurchaseCost] = useState('0');
  const [retailPrice, setRetailPrice] = useState('0');
  const [wholesalePrice, setWholesalePrice] = useState('0');
  const [taxRate, setTaxRate] = useState(0);
  const [isTaxInclusive, setIsTaxInclusive] = useState(true);
  const [costMethod, setCostMethod] = useState<CostMethod>('weighted_average');

  // Inventory
  const [trackStock, setTrackStock] = useState(true);
  const [allowNegativeStock, setAllowNegativeStock] = useState(false);
  const [openingStock, setOpeningStock] = useState('0');
  const [lowStockThreshold, setLowStockThreshold] = useState(5);

  // Optional attributes
  const [manufacturer, setManufacturer] = useState('');
  const [modelNumber, setModelNumber] = useState('');
  const [countryOfOrigin, setCountryOfOrigin] = useState('');
  const [warrantyMonths, setWarrantyMonths] = useState<number | ''>('');
  const [imagePath, setImagePath] = useState('');
  const [customAttrs, setCustomAttrs] = useState<Array<{ key: string; value: string }>>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (product) {
      setName(product.name || '');
      setSku(product.sku || '');
      setBarcode(product.barcode || '');
      setProductType(product.productType || 'standard');
      setCategoryId(product.categoryId || '');
      setBrandId(product.brandId || '');
      setBaseUnitId(product.baseUnitId || 1);
      setDefaultSaleUnitId(product.defaultSaleUnitId || product.baseUnitId || 1);
      setDefaultPurchaseUnitId(product.defaultPurchaseUnitId || product.baseUnitId || 1);
      setPurchaseCost(((product.costPrice || 0) / 100).toFixed(2));
      setRetailPrice(((product.sellingPrice || 0) / 100).toFixed(2));
      setWholesalePrice('0');
      setTaxRate(product.taxRate || 0);
      setIsTaxInclusive(product.isTaxInclusive !== false);
      setCostMethod(product.costMethod || 'weighted_average');
      setTrackStock(product.trackStock !== false);
      setAllowNegativeStock(Boolean(product.allowNegativeStock));
      setOpeningStock(String(product.currentStock || 0));
      setLowStockThreshold(product.minStockLevel || 5);
      setImagePath(product.imagePath || '');

      if (product.details) {
        setManufacturer(product.details.manufacturer || '');
        setModelNumber(product.details.modelNumber || '');
        setCountryOfOrigin(product.details.countryOfOrigin || '');
        setWarrantyMonths(product.details.warrantyMonths || '');
        if (product.details.customAttributes) {
          const pairs = Object.entries(product.details.customAttributes).map(([k, v]) => ({
            key: k,
            value: String(v)
          }));
          setCustomAttrs(pairs);
        } else {
          setCustomAttrs([]);
        }
      } else {
        setManufacturer('');
        setModelNumber('');
        setCountryOfOrigin('');
        setWarrantyMonths('');
        setCustomAttrs([]);
      }
    } else {
      // New product defaults
      const randSuffix = Math.floor(1000 + Math.random() * 9000);
      setName('');
      setSku(`SKU-${randSuffix}`);
      setBarcode(`BAR-${randSuffix}`);
      setProductType('standard');
      setCategoryId(categories[0]?.id || '');
      setBrandId('');
      setBaseUnitId(units[0]?.id || 1);
      setDefaultSaleUnitId(units[0]?.id || 1);
      setDefaultPurchaseUnitId(units[0]?.id || 1);
      setPurchaseCost('0.00');
      setRetailPrice('0.00');
      setWholesalePrice('0.00');
      setTaxRate(0);
      setIsTaxInclusive(true);
      setCostMethod('weighted_average');
      setTrackStock(true);
      setAllowNegativeStock(false);
      setOpeningStock('0');
      setLowStockThreshold(5);
      setImagePath('');
      setManufacturer('');
      setModelNumber('');
      setCountryOfOrigin('');
      setWarrantyMonths('');
      setCustomAttrs([]);
    }
    setError(null);
  }, [product, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (keepOpenForNew = false) => {
    if (!name.trim()) {
      setError('Product name is required.');
      return;
    }
    if (!sku.trim()) {
      setError('Product SKU is required.');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const parsedCostMinor = Math.round(parseFloat(purchaseCost || '0') * 100);
      const parsedRetailMinor = Math.round(parseFloat(retailPrice || '0') * 100);
      const parsedWholesaleMinor = Math.round(parseFloat(wholesalePrice || '0') * 100);
      const parsedOpeningScaled = Math.round(parseFloat(openingStock || '0') * 10000);

      const customObj: Record<string, string> = {};
      for (const attr of customAttrs) {
        if (attr.key.trim()) {
          customObj[attr.key.trim()] = attr.value;
        }
      }

      const dto = {
        businessId,
        sku: sku.trim(),
        name: name.trim(),
        productType,
        categoryId: categoryId || undefined,
        brandId: brandId || undefined,
        baseUnitId,
        defaultSaleUnitId,
        defaultPurchaseUnitId,
        costMethod,
        trackStock,
        allowNegativeStock,
        barcode: barcode.trim() || undefined,
        purchaseCostMinor: parsedCostMinor,
        retailPriceMinor: parsedRetailMinor,
        wholesalePriceMinor: parsedWholesaleMinor > 0 ? parsedWholesaleMinor : undefined,
        openingStockScaled: parsedOpeningScaled,
        lowStockThreshold: Number(lowStockThreshold) || 5,
        taxRate: Number(taxRate) || 0,
        isTaxInclusive,
        imagePath: imagePath.trim() || undefined,
        details: (manufacturer || modelNumber || countryOfOrigin || warrantyMonths !== '' || Object.keys(customObj).length > 0)
          ? {
              manufacturer: manufacturer.trim() || undefined,
              modelNumber: modelNumber.trim() || undefined,
              countryOfOrigin: countryOfOrigin.trim() || undefined,
              warrantyMonths: warrantyMonths !== '' ? Number(warrantyMonths) : undefined,
              customAttributes: Object.keys(customObj).length > 0 ? customObj : undefined
            }
          : undefined
      };

      let savedResult;
      const api = (window as any).posApi;

      if (product?.id && api?.catalogue?.updateProduct) {
        savedResult = await api.catalogue.updateProduct(product.id, dto);
      } else if (api?.catalogue?.createProduct) {
        savedResult = await api.catalogue.createProduct(dto);
      } else {
        savedResult = dto;
      }

      onSaved(savedResult, keepOpenForNew);

      if (keepOpenForNew) {
        // Reset form for next item
        setName('');
        const rand = Math.floor(1000 + Math.random() * 9000);
        setSku(`SKU-${rand}`);
        setBarcode(`BAR-${rand}`);
        setOpeningStock('0');
        setManufacturer('');
        setModelNumber('');
      } else {
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save product');
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!product?.id) return;
    if (!confirm(`Are you sure you want to archive "${product.name}"? This disables new checkout sales while preserving all history.`)) {
      return;
    }
    try {
      setSaving(true);
      const api = (window as any).posApi;
      if (api?.catalogue?.archiveProduct) {
        await api.catalogue.archiveProduct(businessId, product.id);
      }
      onSaved({ ...product, isActive: false }, false);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to archive product');
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async () => {
    if (!product?.id) return;
    const newSku = prompt('Enter a new unique SKU for the duplicate product:', `${product.sku}-COPY`);
    if (!newSku) return;

    try {
      setSaving(true);
      const api = (window as any).posApi;
      let duplicated;
      if (api?.catalogue?.duplicateProduct) {
        duplicated = await api.catalogue.duplicateProduct(businessId, product.id, newSku);
      }
      onSaved(duplicated, false);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to duplicate product');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">
                {product ? `Edit Product: ${product.name}` : 'Create New Product'}
              </h2>
              <p className="text-xs text-slate-400">
                Universal catalogue master supporting retail, pharmacy, apparel, electronics, and wholesale
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-sm text-slate-300">
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-xs">
              {error}
            </div>
          )}

          {/* Primary Product Identity */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 space-y-1">
              <label className="text-xs font-semibold text-slate-300">Product Name *</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Panadol 500mg, Cotton T-Shirt L, Basmati Rice"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">Product Type</label>
              <select
                value={productType}
                onChange={e => setProductType(e.target.value as ProductType)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="standard">Standard (Unit Item)</option>
                <option value="weighted">Weighed (Scale loose produce)</option>
                <option value="variant_parent">Variant Parent (Apparel/Shoes)</option>
                <option value="variant">Variant Child SKU</option>
                <option value="service">Service (Non-inventory item)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">SKU Code *</label>
              <input
                type="text"
                value={sku}
                onChange={e => setSku(e.target.value)}
                placeholder="SKU-XXXX"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">Barcode</label>
              <input
                type="text"
                value={barcode}
                onChange={e => setBarcode(e.target.value)}
                placeholder="EAN-13, UPC, or custom"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">Base Measurement Unit *</label>
              <select
                value={baseUnitId}
                onChange={e => {
                  setBaseUnitId(e.target.value);
                  setDefaultSaleUnitId(e.target.value);
                  setDefaultPurchaseUnitId(e.target.value);
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
              >
                {units.map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">Category</label>
              <select
                value={categoryId}
                onChange={e => setCategoryId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="">-- No Category --</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">Brand / Maker</label>
              <select
                value={brandId}
                onChange={e => setBrandId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="">-- No Brand --</option>
                {brands.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Collapsible Section 1: Pricing & Costing */}
          <div className="border border-slate-800 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setSectionPricing(!sectionPricing)}
              className="w-full px-4 py-3 bg-slate-950/60 hover:bg-slate-950 flex items-center justify-between text-left transition"
            >
              <div className="flex items-center gap-2 font-semibold text-white">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                <span>Pricing, Valuation & Taxes</span>
              </div>
              {sectionPricing ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
            </button>

            {sectionPricing && (
              <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-800/60 bg-slate-900/50">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Retail Sale Price (Rs.)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={retailPrice}
                    onChange={e => setRetailPrice(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Purchase Cost Price (Rs.)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={purchaseCost}
                    onChange={e => setPurchaseCost(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Wholesale Price (Rs.)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={wholesalePrice}
                    onChange={e => setWholesalePrice(e.target.value)}
                    placeholder="Optional volume rate"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Inventory Cost Method</label>
                  <select
                    value={costMethod}
                    onChange={e => setCostMethod(e.target.value as CostMethod)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="weighted_average">Moving Weighted Average (MAC)</option>
                    <option value="fifo">First-In First-Out (FIFO)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Tax Rate (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={taxRate}
                    onChange={e => setTaxRate(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div className="flex items-center gap-3 pt-6">
                  <input
                    type="checkbox"
                    id="taxInclusive"
                    checked={isTaxInclusive}
                    onChange={e => setIsTaxInclusive(e.target.checked)}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-0 bg-slate-950 border-slate-800"
                  />
                  <label htmlFor="taxInclusive" className="text-xs font-semibold text-slate-300 cursor-pointer">
                    Price is Tax-Inclusive
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Collapsible Section 2: Inventory & Units */}
          <div className="border border-slate-800 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setSectionInventory(!sectionInventory)}
              className="w-full px-4 py-3 bg-slate-950/60 hover:bg-slate-950 flex items-center justify-between text-left transition"
            >
              <div className="flex items-center gap-2 font-semibold text-white">
                <Layers className="w-4 h-4 text-cyan-400" />
                <span>Stock Control & Units</span>
              </div>
              {sectionInventory ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
            </button>

            {sectionInventory && (
              <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-800/60 bg-slate-900/50">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Initial Opening Stock</label>
                  <input
                    type="number"
                    step="0.01"
                    value={openingStock}
                    onChange={e => setOpeningStock(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Low-Stock Alert Level</label>
                  <input
                    type="number"
                    value={lowStockThreshold}
                    onChange={e => setLowStockThreshold(parseInt(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div className="flex items-center gap-6 pt-6">
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={trackStock}
                      onChange={e => setTrackStock(e.target.checked)}
                      className="w-4 h-4 rounded text-indigo-600 focus:ring-0 bg-slate-950 border-slate-800"
                    />
                    <span>Track Stock</span>
                  </label>

                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowNegativeStock}
                      onChange={e => setAllowNegativeStock(e.target.checked)}
                      className="w-4 h-4 rounded text-indigo-600 focus:ring-0 bg-slate-950 border-slate-800"
                    />
                    <span>Allow Negative Stock</span>
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Collapsible Section 3: Industry-Specific & Optional Attributes */}
          <div className="border border-slate-800 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setSectionAttributes(!sectionAttributes)}
              className="w-full px-4 py-3 bg-slate-950/60 hover:bg-slate-950 flex items-center justify-between text-left transition"
            >
              <div className="flex items-center gap-2 font-semibold text-white">
                <Tag className="w-4 h-4 text-purple-400" />
                <span>Industry Attributes & Custom Fields</span>
              </div>
              {sectionAttributes ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
            </button>

            {sectionAttributes && (
              <div className="p-4 space-y-4 border-t border-slate-800/60 bg-slate-900/50">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">Manufacturer</label>
                    <input
                      type="text"
                      value={manufacturer}
                      onChange={e => setManufacturer(e.target.value)}
                      placeholder="e.g. GSK, Samsung, Nestle"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">Model Number</label>
                    <input
                      type="text"
                      value={modelNumber}
                      onChange={e => setModelNumber(e.target.value)}
                      placeholder="e.g. SM-S928B"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">Country of Origin</label>
                    <input
                      type="text"
                      value={countryOfOrigin}
                      onChange={e => setCountryOfOrigin(e.target.value)}
                      placeholder="e.g. Pakistan, Japan, Germany"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">Warranty (Months)</label>
                    <input
                      type="number"
                      value={warrantyMonths}
                      onChange={e => setWarrantyMonths(e.target.value ? parseInt(e.target.value) : '')}
                      placeholder="e.g. 12"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>
                </div>

                {/* Custom Key-Value Attributes */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300">Custom Sector Attributes (JSON)</span>
                    <button
                      type="button"
                      onClick={() => setCustomAttrs([...customAttrs, { key: '', value: '' }])}
                      className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Attribute
                    </button>
                  </div>

                  {customAttrs.map((attr, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Key (e.g. Dosage, Fabric, Storage)"
                        value={attr.key}
                        onChange={e => {
                          const updated = [...customAttrs];
                          updated[idx].key = e.target.value;
                          setCustomAttrs(updated);
                        }}
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white"
                      />
                      <input
                        type="text"
                        placeholder="Value (e.g. 500mg, 100% Cotton, 2-8°C)"
                        value={attr.value}
                        onChange={e => {
                          const updated = [...customAttrs];
                          updated[idx].value = e.target.value;
                          setCustomAttrs(updated);
                        }}
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white"
                      />
                      <button
                        type="button"
                        onClick={() => setCustomAttrs(customAttrs.filter((_, i) => i !== idx))}
                        className="text-slate-500 hover:text-rose-400 p-1.5"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/80 rounded-b-2xl flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {product?.id && (
              <>
                <button
                  type="button"
                  onClick={handleArchive}
                  disabled={saving}
                  className="px-3 py-2 bg-slate-800 hover:bg-rose-950 hover:text-rose-300 text-slate-300 text-xs font-semibold rounded-xl border border-slate-700 flex items-center gap-1.5 transition"
                >
                  <Archive className="w-3.5 h-3.5" /> Archive Product
                </button>
                <button
                  type="button"
                  onClick={handleDuplicate}
                  disabled={saving}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl border border-slate-700 flex items-center gap-1.5 transition"
                >
                  <Copy className="w-3.5 h-3.5" /> Duplicate
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition"
            >
              Cancel
            </button>

            {!product && (
              <button
                type="button"
                onClick={() => handleSubmit(true)}
                disabled={saving}
                className="px-4 py-2 bg-indigo-950 border border-indigo-700 hover:bg-indigo-900 text-indigo-300 text-xs font-semibold rounded-xl transition"
              >
                Save & Add Another
              </button>
            )}

            <button
              type="button"
              onClick={() => handleSubmit(false)}
              disabled={saving}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-indigo-600/30 flex items-center gap-1.5 transition"
            >
              <Check className="w-4 h-4" /> Save Product
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

