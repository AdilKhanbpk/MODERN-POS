import React, { useState, useEffect } from 'react';
import {
  QrCode,
  Search,
  Plus,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  RotateCcw,
  Wrench,
  ArrowRightLeft,
  Sliders,
  History,
  CheckCircle2,
  XCircle,
  FileText,
  Smartphone,
  Laptop
} from 'lucide-react';
import {
  ProductSerialNumber,
  SerialStatus,
  SerialAuditDetail,
  SerialSearchQuery
} from '../../../shared/types/serial-tracking';

export const SerialTrackingView: React.FC = () => {
  const [serials, setSerials] = useState<ProductSerialNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedLocation, setSelectedLocation] = useState<string>('all');
  const [products, setProducts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);

  // Modals
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [selectedAuditDetail, setSelectedAuditDetail] = useState<SerialAuditDetail | null>(null);
  const [loadingAudit, setLoadingAudit] = useState(false);

  // Form States
  const [receiveForm, setReceiveForm] = useState({
    productId: '',
    stockLocationId: '',
    supplierId: '',
    quantity: 1,
    unitCost: 0,
    serialsText: '',
    isManualEntry: true
  });

  const [settingsForm, setSettingsForm] = useState({
    productId: '',
    serialTrackingRequired: true,
    warrantyDefaultMonths: 12,
    allowManualSerialEntry: true,
    prefix: '',
    validateImeiLuhn: false
  });

  const [returnForm, setReturnForm] = useState({
    serialNumber: '',
    condition: 'working' as 'working' | 'damaged' | 'inspection',
    hasOriginalReceipt: true,
    receiptNumber: '',
    reason: '',
    managerApproved: false
  });

  const businessId = '00000000-0000-0000-0000-000000000001';

  const loadData = async () => {
    try {
      setLoading(true);
      if (window.posApi) {
        const [prodList, locList] = await Promise.all([
          window.posApi.inventory?.listProducts() || [],
          (window.posApi as any).stockLocations?.list(businessId) || []
        ]);
        setProducts(prodList || []);
        setLocations(locList || []);

        if (locList && locList.length > 0 && !receiveForm.stockLocationId) {
          setReceiveForm((prev) => ({ ...prev, stockLocationId: locList[0].id }));
        }

        const query: SerialSearchQuery = {
          businessId,
          query: searchQuery || undefined,
          status: selectedStatus !== 'all' ? (selectedStatus as SerialStatus) : undefined,
          currentLocationId: selectedLocation !== 'all' ? selectedLocation : undefined
        };

        const res = await (window.posApi as any).serialTracking?.search(query);
        setSerials(res?.items || []);
      }
    } catch (err) {
      console.error('Failed to load serial data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [searchQuery, selectedStatus, selectedLocation]);

  const handleOpenAudit = async (serial: ProductSerialNumber) => {
    try {
      setLoadingAudit(true);
      setIsAuditModalOpen(true);
      const audit = await (window.posApi as any).serialTracking?.getAudit(businessId, serial.serialNumber);
      setSelectedAuditDetail(audit);
    } catch (err) {
      console.error('Failed to get serial audit:', err);
    } finally {
      setLoadingAudit(false);
    }
  };

  const handleReceiveSerials = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const rawSerials = receiveForm.serialsText
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      if (rawSerials.length === 0) {
        alert('Please enter or scan at least one serial number.');
        return;
      }

      const items = rawSerials.map((sn) => {
        const parts = sn.split(',').map((p) => p.trim());
        return {
          serialNumber: parts[0],
          imei1: parts[1] || undefined,
          isManualEntry: receiveForm.isManualEntry
        };
      });

      await (window.posApi as any).serialTracking?.receiveUnits({
        businessId,
        productId: receiveForm.productId,
        stockLocationId: receiveForm.stockLocationId,
        supplierId: receiveForm.supplierId || undefined,
        quantityScaled: items.length * 1000,
        unitCostMinor: Math.round(receiveForm.unitCost * 100),
        serials: items
      });

      setIsReceiveModalOpen(false);
      setReceiveForm({
        productId: '',
        stockLocationId: locations[0]?.id || '',
        supplierId: '',
        quantity: 1,
        unitCost: 0,
        serialsText: '',
        isManualEntry: true
      });
      loadData();
    } catch (err: any) {
      alert(`Error receiving serials: ${err.message}`);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await (window.posApi as any).serialTracking?.configureSettings({
        businessId,
        productId: settingsForm.productId,
        serialTrackingRequired: settingsForm.serialTrackingRequired,
        warrantyDefaultMonths: settingsForm.warrantyDefaultMonths,
        allowManualSerialEntry: settingsForm.allowManualSerialEntry,
        serialFormatRule: {
          prefix: settingsForm.prefix || undefined,
          validateImeiLuhn: settingsForm.validateImeiLuhn
        }
      });
      setIsSettingsModalOpen(false);
      alert('Serial settings updated successfully.');
      loadData();
    } catch (err: any) {
      alert(`Error updating settings: ${err.message}`);
    }
  };

  const handleProcessReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await (window.posApi as any).serialTracking?.customerReturn({
        businessId,
        serialNumber: returnForm.serialNumber,
        condition: returnForm.condition,
        hasOriginalReceipt: returnForm.hasOriginalReceipt,
        receiptNumber: returnForm.receiptNumber || undefined,
        reason: returnForm.reason,
        managerApproved: returnForm.managerApproved
      });
      setIsReturnModalOpen(false);
      alert('Return processed successfully.');
      loadData();
    } catch (err: any) {
      alert(`Error processing return: ${err.message}`);
    }
  };

  const getStatusBadge = (status: SerialStatus) => {
    switch (status) {
      case 'in_stock':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
            <CheckCircle2 className="w-3 h-3 mr-1" /> In Stock
          </span>
        );
      case 'sold':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            <ShieldCheck className="w-3 h-3 mr-1" /> Sold
          </span>
        );
      case 'under_repair':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
            <Wrench className="w-3 h-3 mr-1" /> Under Repair
          </span>
        );
      case 'quarantined':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-800">
            <AlertTriangle className="w-3 h-3 mr-1" /> Quarantined
          </span>
        );
      case 'written_off':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-700">
            <XCircle className="w-3 h-3 mr-1" /> Written Off
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-lg">
            <QrCode className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Serial-Number & IMEI Tracking</h2>
            <p className="text-sm text-gray-500">
              Individual unit lifecycle, IMEI validation, warranties & condition audit
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setIsSettingsModalOpen(true)}
            className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 shadow-sm transition"
          >
            <Sliders className="w-4 h-4 mr-1.5 text-gray-500" /> Policy Settings
          </button>
          <button
            onClick={() => setIsReturnModalOpen(true)}
            className="inline-flex items-center px-3 py-2 border border-amber-300 rounded-lg text-sm font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 shadow-sm transition"
          >
            <RotateCcw className="w-4 h-4 mr-1.5 text-amber-700" /> Customer Return
          </button>
          <button
            onClick={() => setIsReceiveModalOpen(true)}
            className="inline-flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium shadow-sm transition"
          >
            <Plus className="w-4 h-4 mr-1.5" /> Receive Serials
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3 bg-white p-3 rounded-lg border border-gray-200">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
          <input
            type="text"
            placeholder="Search by Serial Number, IMEI, Invoice #, or Product..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full sm:w-auto"
        >
          <option value="all">All Statuses</option>
          <option value="in_stock">In Stock</option>
          <option value="sold">Sold</option>
          <option value="under_repair">Under Repair</option>
          <option value="quarantined">Quarantined</option>
          <option value="written_off">Written Off</option>
        </select>

        <select
          value={selectedLocation}
          onChange={(e) => setSelectedLocation(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full sm:w-auto"
        >
          <option value="all">All Locations</option>
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.name}
            </option>
          ))}
        </select>

        <button
          onClick={loadData}
          className="p-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Serial Inventory Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-gray-600 font-semibold">
              <tr>
                <th className="px-6 py-3 text-left">Serial / IMEI</th>
                <th className="px-6 py-3 text-left">Product</th>
                <th className="px-6 py-3 text-left">Location</th>
                <th className="px-6 py-3 text-left">Status</th>
                <th className="px-6 py-3 text-left">Unit Cost</th>
                <th className="px-6 py-3 text-left">Received Date</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-gray-500">
                    Loading serial numbers...
                  </td>
                </tr>
              ) : serials.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-500">
                    <Smartphone className="w-12 h-12 mx-auto text-gray-300 mb-2" />
                    <p className="font-medium text-gray-700">No serial numbers found</p>
                    <p className="text-xs text-gray-400 mt-1">Receive serial-tracked products to begin.</p>
                  </td>
                </tr>
              ) : (
                serials.map((serial) => {
                  const product = products.find((p) => String(p.id) === String(serial.productId));
                  const location = locations.find((l) => String(l.id) === String(serial.currentLocationId));
                  return (
                    <tr key={serial.id} className="hover:bg-gray-50 transition">
                      <td className="px-6 py-3 font-mono font-medium text-indigo-700">
                        <div>{serial.serialNumber}</div>
                        {serial.imei1 && (
                          <div className="text-xs text-gray-500 font-sans">IMEI: {serial.imei1}</div>
                        )}
                      </td>
                      <td className="px-6 py-3 text-gray-900 font-medium">
                        {product ? product.name : `Product #${serial.productId}`}
                      </td>
                      <td className="px-6 py-3 text-gray-600">
                        {location ? location.name : serial.currentLocationId || 'N/A'}
                      </td>
                      <td className="px-6 py-3">{getStatusBadge(serial.status)}</td>
                      <td className="px-6 py-3 font-mono text-gray-700">
                        {serial.unitCostMinor != null ? `Rs. ${(serial.unitCostMinor / 100).toFixed(2)}` : '••••••'}
                      </td>
                      <td className="px-6 py-3 text-gray-500 text-xs">
                        {serial.receivedAt ? serial.receivedAt.substring(0, 10) : 'N/A'}
                      </td>
                      <td className="px-6 py-3 text-right">
                        <button
                          onClick={() => handleOpenAudit(serial)}
                          className="inline-flex items-center px-2.5 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-md transition"
                        >
                          <History className="w-3.5 h-3.5 mr-1" /> Full History
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* RECEIVE SERIALS MODAL */}
      {isReceiveModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900 flex items-center">
              <Plus className="w-5 h-5 mr-2 text-indigo-600" /> Receive Serial-Tracked Units
            </h3>

            <form onSubmit={handleReceiveSerials} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Product</label>
                <select
                  required
                  value={receiveForm.productId}
                  onChange={(e) => setReceiveForm({ ...receiveForm, productId: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white"
                >
                  <option value="">Select serial-tracked product...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Stock Location</label>
                  <select
                    required
                    value={receiveForm.stockLocationId}
                    onChange={(e) => setReceiveForm({ ...receiveForm, stockLocationId: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white"
                  >
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Unit Cost (Rs.)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={receiveForm.unitCost}
                    onChange={(e) => setReceiveForm({ ...receiveForm, unitCost: parseFloat(e.target.value) || 0 })}
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Serial Numbers (One per line, or "Serial, IMEI")
                </label>
                <textarea
                  rows={4}
                  required
                  placeholder="SN-LAPTOP-101&#10;SN-LAPTOP-102&#10;SN-PHONE-001, 860123456789012"
                  value={receiveForm.serialsText}
                  onChange={(e) => setReceiveForm({ ...receiveForm, serialsText: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm font-mono"
                />
                <span className="text-xs text-gray-400">
                  Each line creates 1 physical unit record with individual stock traceability.
                </span>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsReceiveModalOpen(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium shadow-sm"
                >
                  Confirm Receipt
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* POLICY SETTINGS MODAL */}
      {isSettingsModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900 flex items-center">
              <Sliders className="w-5 h-5 mr-2 text-indigo-600" /> Serial & Warranty Settings
            </h3>

            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Target Product</label>
                <select
                  required
                  value={settingsForm.productId}
                  onChange={(e) => setSettingsForm({ ...settingsForm, productId: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white"
                >
                  <option value="">Select product to configure...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="reqSerial"
                  checked={settingsForm.serialTrackingRequired}
                  onChange={(e) => setSettingsForm({ ...settingsForm, serialTrackingRequired: e.target.checked })}
                  className="rounded text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="reqSerial" className="text-sm font-medium text-gray-800">
                  Require Individual Serial Number
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Default Warranty (Months)</label>
                  <input
                    type="number"
                    min="0"
                    value={settingsForm.warrantyDefaultMonths}
                    onChange={(e) => setSettingsForm({ ...settingsForm, warrantyDefaultMonths: parseInt(e.target.value, 10) || 0 })}
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Required Prefix (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. SN-"
                    value={settingsForm.prefix}
                    onChange={(e) => setSettingsForm({ ...settingsForm, prefix: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="allowManual"
                    checked={settingsForm.allowManualSerialEntry}
                    onChange={(e) => setSettingsForm({ ...settingsForm, allowManualSerialEntry: e.target.checked })}
                    className="rounded text-indigo-600"
                  />
                  <label htmlFor="allowManual" className="text-sm text-gray-700">
                    Allow Manual Serial Entry (Keyboard)
                  </label>
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="valImei"
                    checked={settingsForm.validateImeiLuhn}
                    onChange={(e) => setSettingsForm({ ...settingsForm, validateImeiLuhn: e.target.checked })}
                    className="rounded text-indigo-600"
                  />
                  <label htmlFor="valImei" className="text-sm text-gray-700">
                    Validate IMEI Luhn Checksum
                  </label>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsSettingsModalOpen(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium shadow-sm"
                >
                  Save Policy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CUSTOMER RETURN MODAL */}
      {isReturnModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900 flex items-center">
              <RotateCcw className="w-5 h-5 mr-2 text-amber-600" /> Process Serial Return
            </h3>

            <form onSubmit={handleProcessReturn} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Serial Number</label>
                <input
                  type="text"
                  required
                  placeholder="Scan or enter sold serial..."
                  value={returnForm.serialNumber}
                  onChange={(e) => setReturnForm({ ...returnForm, serialNumber: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Return Condition</label>
                <select
                  value={returnForm.condition}
                  onChange={(e) => setReturnForm({ ...returnForm, condition: e.target.value as any })}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white"
                >
                  <option value="working">Working / Resellable (Returns to In-Stock)</option>
                  <option value="damaged">Damaged / Defective (Moves to Under-Repair)</option>
                  <option value="inspection">Under Inspection (Moves to Quarantine)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Reason for Return</label>
                <textarea
                  rows={2}
                  required
                  placeholder="Customer changed mind / defective screen / wrong model..."
                  value={returnForm.reason}
                  onChange={(e) => setReturnForm({ ...returnForm, reason: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                />
              </div>

              <div className="space-y-2 pt-1">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="hasReceipt"
                    checked={returnForm.hasOriginalReceipt}
                    onChange={(e) => setReturnForm({ ...returnForm, hasOriginalReceipt: e.target.checked })}
                    className="rounded text-amber-600"
                  />
                  <label htmlFor="hasReceipt" className="text-sm text-gray-700">
                    Original receipt presented
                  </label>
                </div>

                {!returnForm.hasOriginalReceipt && (
                  <div className="flex items-center space-x-2 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
                    <input
                      type="checkbox"
                      id="mgrApprove"
                      checked={returnForm.managerApproved}
                      onChange={(e) => setReturnForm({ ...returnForm, managerApproved: e.target.checked })}
                      className="rounded text-amber-600"
                    />
                    <label htmlFor="mgrApprove" className="text-xs text-amber-900 font-semibold">
                      Manager Override: Approve return without original receipt
                    </label>
                  </div>
                )}
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsReturnModalOpen(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium shadow-sm"
                >
                  Process Return
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AUDIT & TIMELINE MODAL */}
      {isAuditModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-lg font-bold text-gray-900 flex items-center">
                  <History className="w-5 h-5 mr-2 text-indigo-600" /> Traceability & Service Audit
                </h3>
                <p className="text-xs text-gray-500 font-mono">
                  {selectedAuditDetail?.serial.serialNumber}
                </p>
              </div>
              <button
                onClick={() => setIsAuditModalOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            {loadingAudit || !selectedAuditDetail ? (
              <div className="text-center py-8 text-gray-500">Loading audit trail...</div>
            ) : (
              <div className="space-y-4">
                {/* Product & Current Status Summary */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-gray-50 p-3 rounded-lg text-xs">
                  <div>
                    <span className="text-gray-500 block">Product</span>
                    <span className="font-semibold text-gray-900">{selectedAuditDetail.product.name}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Status</span>
                    <span>{getStatusBadge(selectedAuditDetail.serial.status)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Location</span>
                    <span className="font-medium text-gray-800">
                      {selectedAuditDetail.location?.name || 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Warranty</span>
                    <span
                      className={`font-semibold ${
                        selectedAuditDetail.warranty?.isActive ? 'text-emerald-700' : 'text-gray-500'
                      }`}
                    >
                      {selectedAuditDetail.warranty
                        ? `${selectedAuditDetail.warranty.isActive ? 'Active' : 'Expired'} (${
                            selectedAuditDetail.warranty.daysRemaining
                          } days)`
                        : 'No Warranty'}
                    </span>
                  </div>
                </div>

                {/* Sale & Customer Details */}
                {selectedAuditDetail.sale && (
                  <div className="bg-blue-50 border border-blue-100 p-3 rounded-lg text-xs space-y-1">
                    <span className="font-bold text-blue-900 block">Sale & Customer Record</span>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <span className="text-blue-700">Invoice:</span> {selectedAuditDetail.sale.invoiceNumber}
                      </div>
                      <div>
                        <span className="text-blue-700">Customer:</span>{' '}
                        {selectedAuditDetail.sale.customerName || 'Walk-in'}
                      </div>
                      <div>
                        <span className="text-blue-700">Date:</span> {selectedAuditDetail.sale.saleDate.substring(0, 10)}
                      </div>
                    </div>
                  </div>
                )}

                {/* Chronological History Timeline */}
                <div>
                  <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                    Lifecycle Timeline
                  </h4>
                  <div className="border-l-2 border-indigo-200 ml-3 pl-4 space-y-3">
                    {selectedAuditDetail.history.map((event) => (
                      <div key={event.id} className="relative text-xs">
                        <div className="absolute -left-[23px] top-1 w-2.5 h-2.5 rounded-full bg-indigo-600 ring-4 ring-white" />
                        <div className="font-semibold text-gray-900 flex items-center justify-between">
                          <span>{event.eventType}</span>
                          <span className="text-gray-400 font-normal">{event.occurredAt.replace('T', ' ').substring(0, 19)}</span>
                        </div>
                        {event.notes && <p className="text-gray-600 mt-0.5">{event.notes}</p>}
                        {event.fromStatus && event.toStatus && (
                          <div className="text-gray-400 mt-0.5">
                            Status: <span className="font-mono">{event.fromStatus}</span> →{' '}
                            <span className="font-mono text-gray-700">{event.toStatus}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

