import React, { useState, useEffect } from 'react';
import {
  X, Barcode, Scale, Plus, Check, AlertCircle, ShieldAlert,
  Tag, Package, Star, Trash2, RefreshCw, Cpu
} from 'lucide-react';
import { ProductBarcode, ScaleBarcodeProfile, ScaleBarcodeTestResult } from '../../../shared/types/barcode';

export interface BarcodeManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  productId?: string | number;
  productName?: string;
  businessId: string;
}

export const BarcodeManagementModal: React.FC<BarcodeManagementModalProps> = ({
  isOpen,
  onClose,
  productId,
  productName,
  businessId
}) => {
  const [activeTab, setActiveTab] = useState<'PRODUCT_BARCODES' | 'SCALE_DIAGNOSTICS'>('PRODUCT_BARCODES');

  // Barcode list state
  const [barcodes, setBarcodes] = useState<ProductBarcode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New barcode form state
  const [newBarcodeValue, setNewBarcodeValue] = useState('');
  const [newBarcodeType, setNewBarcodeType] = useState('EAN13');
  const [newIsPrimary, setNewIsPrimary] = useState(false);
  const [selectedConversionId, setSelectedConversionId] = useState<string>('');
  const [conversions, setConversions] = useState<any[]>([]);

  // Scale diagnostic state
  const [scaleProfiles, setScaleProfiles] = useState<ScaleBarcodeProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [testBarcodeInput, setTestBarcodeInput] = useState('2012345012505');
  const [diagnosticResult, setDiagnosticResult] = useState<ScaleBarcodeTestResult | null>(null);

  const api = (window as any).posApi;

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      if (productId && api?.barcodes?.listProductBarcodes) {
        const list = await api.barcodes.listProductBarcodes(productId);
        setBarcodes(list || []);
      }

      if (productId && api?.units?.getConversions) {
        const convList = await api.units.getConversions(productId);
        setConversions(convList || []);
      }

      if (api?.barcodes?.listScaleProfiles) {
        const profiles = await api.barcodes.listScaleProfiles(businessId);
        setScaleProfiles(profiles || []);
        if (profiles?.length > 0 && !selectedProfileId) {
          setSelectedProfileId(profiles[0].id);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load barcode data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, productId]);

  // Run scale diagnostic test whenever input or profile changes
  useEffect(() => {
    if (activeTab === 'SCALE_DIAGNOSTICS' && selectedProfileId && testBarcodeInput.trim()) {
      runDiagnosticTest();
    }
  }, [testBarcodeInput, selectedProfileId, activeTab]);

  const runDiagnosticTest = async () => {
    try {
      if (api?.barcodes?.testScaleProfile) {
        const res = await api.barcodes.testScaleProfile(testBarcodeInput.trim(), selectedProfileId);
        setDiagnosticResult(res);
      }
    } catch (err: any) {
      setDiagnosticResult({
        isValid: false,
        rawBarcode: testBarcodeInput,
        profileName: 'Error',
        prefixSegment: '',
        productCodeSegment: '',
        valueSegment: '',
        valueType: 'weight',
        parsedValue: 0,
        error: err.message
      });
    }
  };

  const handleAddBarcode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBarcodeValue.trim() || !productId) return;

    try {
      setLoading(true);
      setError(null);

      await api.barcodes.addBarcode(
        {
          businessId,
          productId,
          barcodeValue: newBarcodeValue.trim(),
          barcodeType: newBarcodeType,
          isPrimary: newIsPrimary,
          productUnitConversionId: selectedConversionId || null
        },
        { userId: 1, role: 'Administrator', businessId }
      );

      setNewBarcodeValue('');
      setNewIsPrimary(false);
      setSelectedConversionId('');
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to add barcode.');
    } finally {
      setLoading(false);
    }
  };

  const handleSetPrimary = async (barcodeId: string) => {
    if (!productId) return;
    try {
      setLoading(true);
      await api.barcodes.setPrimary(businessId, productId, barcodeId);
      await loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeactivate = async (barcodeId: string) => {
    try {
      setLoading(true);
      await api.barcodes.deactivate(businessId, barcodeId);
      await loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-3xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-slate-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-600/20 text-blue-400 rounded-xl">
              <Barcode className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Barcode & Scale Management</h2>
              <p className="text-xs text-slate-400">
                {productName ? `Item: ${productName}` : 'Multi-barcode assignment & scale barcode profiles'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex border-b border-slate-800 bg-slate-950/20 px-6 pt-2">
          <button
            onClick={() => setActiveTab('PRODUCT_BARCODES')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
              activeTab === 'PRODUCT_BARCODES'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Barcode className="w-4 h-4" />
            Product Barcodes
          </button>
          <button
            onClick={() => setActiveTab('SCALE_DIAGNOSTICS')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
              activeTab === 'SCALE_DIAGNOSTICS'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Scale className="w-4 h-4" />
            Scale Barcode Diagnostics
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center gap-2 text-rose-400 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {activeTab === 'PRODUCT_BARCODES' ? (
            <div className="space-y-6">
              {/* Add Barcode Form */}
              <form onSubmit={handleAddBarcode} className="p-4 bg-slate-950/40 border border-slate-800 rounded-xl space-y-3">
                <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Assign New Barcode
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                  <div className="md:col-span-2">
                    <label className="block text-slate-400 mb-1">Barcode Value / Scan Input</label>
                    <input
                      type="text"
                      required
                      placeholder="Scan or type barcode (e.g. 890123456789)"
                      value={newBarcodeValue}
                      onChange={(e) => setNewBarcodeValue(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Barcode Format</label>
                    <select
                      value={newBarcodeType}
                      onChange={(e) => setNewBarcodeType(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white"
                    >
                      <option value="EAN13">EAN-13</option>
                      <option value="UPC">UPC-A</option>
                      <option value="CODE128">Code 128</option>
                      <option value="CODE39">Code 39</option>
                      <option value="INTERNAL">Internal Label</option>
                      <option value="QR">QR Code</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Packaging Unit</label>
                    <select
                      value={selectedConversionId}
                      onChange={(e) => setSelectedConversionId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white"
                    >
                      <option value="">Base Unit (Standard)</option>
                      {conversions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.fromUnitName || 'Pack'} (Factor: {c.toBaseFactorNumerator || c.baseUnitsNumerator})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={newIsPrimary}
                      onChange={(e) => setNewIsPrimary(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-0"
                    />
                    <span>Set as Primary Barcode for Product</span>
                  </label>
                  <button
                    type="submit"
                    disabled={loading || !newBarcodeValue.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Barcode
                  </button>
                </div>
              </form>

              {/* Barcode List Table */}
              <div className="border border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400">
                    <tr>
                      <th className="p-3">Barcode</th>
                      <th className="p-3">Type</th>
                      <th className="p-3">Packaging / Unit</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {barcodes.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-6 text-center text-slate-500">
                          No additional barcodes registered for this product.
                        </td>
                      </tr>
                    ) : (
                      barcodes.map((b) => (
                        <tr key={b.id} className="hover:bg-slate-800/30">
                          <td className="p-3 font-mono font-medium text-white flex items-center gap-2">
                            <span>{b.barcodeValue}</span>
                            {b.isPrimary && (
                              <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                <Star className="w-3 h-3 fill-amber-300" />
                                Primary
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-slate-300">{b.barcodeType}</td>
                          <td className="p-3 text-slate-300">
                            {b.unitName ? (
                              <span className="px-2 py-0.5 rounded bg-blue-900/30 text-blue-300 border border-blue-700/40">
                                {b.unitName} (×{b.conversionNumerator || 1})
                              </span>
                            ) : (
                              <span className="text-slate-500">Base Unit</span>
                            )}
                          </td>
                          <td className="p-3">
                            {b.isActive ? (
                              <span className="text-emerald-400 flex items-center gap-1 text-[11px]">
                                <Check className="w-3 h-3" /> Active
                              </span>
                            ) : (
                              <span className="text-rose-400 text-[11px]">Inactive</span>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {!b.isPrimary && b.isActive && (
                                <button
                                  onClick={() => handleSetPrimary(b.id)}
                                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] transition"
                                >
                                  Make Primary
                                </button>
                              )}
                              {b.isActive && (
                                <button
                                  onClick={() => handleDeactivate(b.id)}
                                  title="Deactivate Barcode"
                                  className="p-1 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 rounded transition"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* Scale Diagnostics Tab */
            <div className="space-y-6">
              <div className="p-4 bg-slate-950/40 border border-slate-800 rounded-xl space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-emerald-400" />
                    Scale Barcode Profile Tester & Validator
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-slate-400 mb-1">Active Scale Profile</label>
                    <select
                      value={selectedProfileId}
                      onChange={(e) => setSelectedProfileId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white"
                    >
                      {scaleProfiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} (Prefix: {p.prefix}, Length: {p.totalLength})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-400 mb-1">Test Scale Barcode Stream</label>
                    <input
                      type="text"
                      value={testBarcodeInput}
                      onChange={(e) => setTestBarcodeInput(e.target.value)}
                      placeholder="e.g. 2012345012505"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                    />
                  </div>
                </div>

                {/* Live Diagnostic Visualization */}
                {diagnosticResult && (
                  <div className="mt-4 p-4 rounded-xl border bg-slate-900/60 border-slate-800 space-y-3">
                    <div className="flex items-center justify-between text-xs border-b border-slate-800 pb-2">
                      <span className="font-semibold text-slate-300">Parser Breakdown</span>
                      {diagnosticResult.isValid ? (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[11px] font-medium border border-emerald-500/30 flex items-center gap-1">
                          <Check className="w-3 h-3" /> Valid Scale Barcode
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 text-[11px] font-medium border border-rose-500/30 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" /> Parse Error
                        </span>
                      )}
                    </div>

                    {/* Segment Pills */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                        <span className="block text-[10px] text-slate-500 uppercase">Prefix</span>
                        <span className="font-mono font-bold text-blue-400">{diagnosticResult.prefixSegment || '—'}</span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                        <span className="block text-[10px] text-slate-500 uppercase">Product Code (PLU)</span>
                        <span className="font-mono font-bold text-amber-400">{diagnosticResult.productCodeSegment || '—'}</span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                        <span className="block text-[10px] text-slate-500 uppercase">
                          Parsed {diagnosticResult.valueType === 'weight' ? 'Weight' : 'Price'}
                        </span>
                        <span className="font-mono font-bold text-emerald-400">
                          {diagnosticResult.parsedValue} {diagnosticResult.valueType === 'weight' ? 'kg' : 'Rs.'}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                        <span className="block text-[10px] text-slate-500 uppercase">Check Digit (EAN-13)</span>
                        <span className="font-mono font-bold text-purple-400">
                          {diagnosticResult.checkDigitSegment || '—'} (Expected: {diagnosticResult.expectedCheckDigit ?? '—'})
                        </span>
                      </div>
                    </div>

                    {diagnosticResult.error && (
                      <p className="text-xs text-rose-400 pt-1">
                        <strong>Failure Reason:</strong> {diagnosticResult.error}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

