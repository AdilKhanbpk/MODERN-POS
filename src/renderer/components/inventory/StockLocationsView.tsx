import React, { useState, useEffect } from 'react';
import {
  StockLocation,
  StockLocationType,
  EnterpriseStockBalance,
  CreateStockLocationDto,
  UpdateStockLocationDto,
  CreateStockTransferDto
} from '../../../shared/types/stock-location';
import {
  Warehouse,
  Plus,
  ArrowRightLeft,
  Search,
  Layers,
  ShieldAlert,
  Boxes,
  Eye,
  History,
  Edit2,
  Archive,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  X
} from 'lucide-react';

export const StockLocationsView: React.FC = () => {
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [includeInactive, setIncludeInactive] = useState(false);

  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isStockModalOpen, setIsStockModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);

  const [activeLocation, setActiveLocation] = useState<StockLocation | null>(null);
  const [locationBalances, setLocationBalances] = useState<EnterpriseStockBalance[]>([]);
  const [locationMovements, setLocationMovements] = useState<any[]>([]);
  const [stockSearch, setStockSearch] = useState('');

  // Form states
  const [formData, setFormData] = useState<CreateStockLocationDto>({
    businessId: '00000000-0000-0000-0000-000000000001',
    branchId: '00000000-0000-0000-0000-000000000002',
    name: '',
    code: '',
    locationType: 'warehouse',
    isDefault: false,
    isSellable: true,
    isReceivable: true,
    isActive: true
  });

  const [transferData, setTransferData] = useState<{
    sourceLocationId: string;
    destinationLocationId: string;
    productId: string;
    quantity: number;
    notes: string;
  }>({
    sourceLocationId: '',
    destinationLocationId: '',
    productId: '',
    quantity: 1,
    notes: ''
  });

  const [availableProducts, setAvailableProducts] = useState<any[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const businessId = '00000000-0000-0000-0000-000000000001';

  const loadLocations = async () => {
    try {
      setLoading(true);
      if (window.posApi?.stockLocations) {
        const list = await window.posApi.stockLocations.list({
          businessId,
          includeInactive
        });
        setLocations(list || []);
      }
      if (window.posApi?.inventory) {
        const prods = await window.posApi.inventory.listProducts();
        setAvailableProducts(prods || []);
      }
    } catch (err: any) {
      console.error('Failed to load locations:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLocations();
  }, [includeInactive]);

  const handleCreateLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      if (!formData.name.trim() || !formData.code.trim()) {
        setFormError('Location name and code are required.');
        return;
      }
      await window.posApi.stockLocations.create(formData);
      setIsCreateModalOpen(false);
      resetForm();
      loadLocations();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create stock location.');
    }
  };

  const handleUpdateLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeLocation) return;
    setFormError(null);
    try {
      await window.posApi.stockLocations.update(activeLocation.id, {
        name: formData.name,
        code: formData.code,
        parentLocationId: formData.parentLocationId || null,
        locationType: formData.locationType,
        isDefault: formData.isDefault,
        isSellable: formData.isSellable,
        isReceivable: formData.isReceivable,
        isActive: formData.isActive
      });
      setIsEditModalOpen(false);
      resetForm();
      loadLocations();
    } catch (err: any) {
      setFormError(err.message || 'Failed to update location.');
    }
  };

  const handleArchiveLocation = async (loc: StockLocation) => {
    if (!window.confirm(`Are you sure you want to archive "${loc.name}" (${loc.code})?`)) return;
    try {
      await window.posApi.stockLocations.archive(loc.id);
      loadLocations();
    } catch (err: any) {
      alert(`Cannot archive location: ${err.message}`);
    }
  };

  const handleOpenStockModal = async (loc: StockLocation) => {
    setActiveLocation(loc);
    try {
      const stock = await window.posApi.stockLocations.getStock(loc.id, businessId);
      setLocationBalances(stock || []);
      setIsStockModalOpen(true);
    } catch (err: any) {
      alert(`Failed to load stock: ${err.message}`);
    }
  };

  const handleOpenHistoryModal = async (loc: StockLocation) => {
    setActiveLocation(loc);
    try {
      const moves = await window.posApi.stockLocations.getMovements(loc.id, businessId);
      setLocationMovements(moves || []);
      setIsHistoryModalOpen(true);
    } catch (err: any) {
      alert(`Failed to load movement history: ${err.message}`);
    }
  };

  const handleExecuteTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      if (!transferData.sourceLocationId || !transferData.destinationLocationId) {
        setFormError('Please select both source and destination locations.');
        return;
      }
      if (transferData.sourceLocationId === transferData.destinationLocationId) {
        setFormError('Source and destination locations cannot be identical.');
        return;
      }
      if (!transferData.productId) {
        setFormError('Please select a product to transfer.');
        return;
      }
      if (transferData.quantity <= 0) {
        setFormError('Transfer quantity must be greater than zero.');
        return;
      }

      const sourceLoc = locations.find((l) => l.id === transferData.sourceLocationId);
      const destLoc = locations.find((l) => l.id === transferData.destinationLocationId);

      const dto: CreateStockTransferDto = {
        businessId,
        sourceBranchId: sourceLoc?.branchId || '',
        destinationBranchId: destLoc?.branchId || '',
        sourceLocationId: transferData.sourceLocationId,
        destinationLocationId: transferData.destinationLocationId,
        notes: transferData.notes,
        items: [
          {
            productId: transferData.productId,
            quantityScaled: Math.round(transferData.quantity * 1000),
            notes: transferData.notes
          }
        ]
      };

      await window.posApi.stockLocations.transfer(dto);
      setIsTransferModalOpen(false);
      setTransferData({
        sourceLocationId: '',
        destinationLocationId: '',
        productId: '',
        quantity: 1,
        notes: ''
      });
      loadLocations();
      alert('Stock transfer completed successfully!');
    } catch (err: any) {
      setFormError(err.message || 'Transfer failed.');
    }
  };

  const resetForm = () => {
    setFormData({
      businessId,
      branchId: '00000000-0000-0000-0000-000000000002',
      name: '',
      code: '',
      locationType: 'warehouse',
      isDefault: false,
      isSellable: true,
      isReceivable: true,
      isActive: true
    });
    setFormError(null);
    setActiveLocation(null);
  };

  const openEditModal = (loc: StockLocation) => {
    setActiveLocation(loc);
    setFormData({
      businessId: loc.businessId,
      branchId: loc.branchId,
      parentLocationId: loc.parentLocationId,
      name: loc.name,
      code: loc.code,
      locationType: loc.locationType,
      isDefault: loc.isDefault,
      isSellable: loc.isSellable,
      isReceivable: loc.isReceivable,
      isActive: loc.isActive
    });
    setIsEditModalOpen(true);
  };

  const filteredLocations = locations.filter((loc) => {
    const matchesSearch =
      loc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      loc.code.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = selectedType === 'all' || loc.locationType === selectedType;
    return matchesSearch && matchesType;
  });

  return (
    <div className="space-y-6">
      {/* Top Banner & Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
            <Warehouse className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Locations</p>
            <p className="text-2xl font-bold text-slate-900">{locations.length}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Sellable Locations</p>
            <p className="text-2xl font-bold text-slate-900">
              {locations.filter((l) => l.isSellable && l.isActive).length}
            </p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-amber-50 text-amber-600 rounded-lg">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Damaged / Quarantine</p>
            <p className="text-2xl font-bold text-slate-900">
              {locations.filter((l) => l.locationType === 'damaged' || l.locationType === 'quarantine').length}
            </p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-purple-50 text-purple-600 rounded-lg">
            <ArrowRightLeft className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Default Location</p>
            <p className="text-sm font-bold text-slate-900 truncate">
              {locations.find((l) => l.isDefault)?.name || 'None Set'}
            </p>
          </div>
        </div>
      </div>

      {/* Control Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-[280px]">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by location name or code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Types</option>
            <option value="shop_floor">Shop Floor</option>
            <option value="warehouse">Warehouse</option>
            <option value="storeroom">Storeroom</option>
            <option value="damaged">Damaged (Non-sellable)</option>
            <option value="quarantine">Quarantine (Non-sellable)</option>
            <option value="other">Other</option>
          </select>

          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            Show Inactive
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setTransferData({
                sourceLocationId: locations[0]?.id || '',
                destinationLocationId: locations[1]?.id || '',
                productId: availableProducts[0]?.id ? String(availableProducts[0].id) : '',
                quantity: 1,
                notes: ''
              });
              setIsTransferModalOpen(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium rounded-lg text-sm transition-colors"
          >
            <ArrowRightLeft className="w-4 h-4 text-slate-600" />
            Transfer Stock
          </button>

          <button
            onClick={() => {
              resetForm();
              setIsCreateModalOpen(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-sm transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            New Location
          </button>
        </div>
      </div>

      {/* Locations Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold text-xs uppercase tracking-wider">
            <tr>
              <th className="py-3 px-4">Code / Name</th>
              <th className="py-3 px-4">Branch</th>
              <th className="py-3 px-4">Parent Location</th>
              <th className="py-3 px-4">Type</th>
              <th className="py-3 px-4">Capabilities</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-slate-400">
                  Loading stock locations...
                </td>
              </tr>
            ) : filteredLocations.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-slate-400">
                  No stock locations found matching your criteria.
                </td>
              </tr>
            ) : (
              filteredLocations.map((loc) => (
                <tr key={loc.id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold px-2 py-0.5 bg-slate-100 text-slate-800 rounded">
                        {loc.code}
                      </span>
                      <span className="font-medium text-slate-900">{loc.name}</span>
                      {loc.isDefault && (
                        <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                          Default
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-700">{loc.branchName || 'Headquarters'}</td>
                  <td className="py-3 px-4 text-slate-500">
                    {loc.parentName ? (
                      <span className="inline-flex items-center gap-1">
                        <Layers className="w-3.5 h-3.5 text-slate-400" />
                        {loc.parentName}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        loc.locationType === 'shop_floor'
                          ? 'bg-blue-50 text-blue-700'
                          : loc.locationType === 'warehouse'
                          ? 'bg-indigo-50 text-indigo-700'
                          : loc.locationType === 'storeroom'
                          ? 'bg-teal-50 text-teal-700'
                          : loc.locationType === 'damaged'
                          ? 'bg-rose-50 text-rose-700'
                          : loc.locationType === 'quarantine'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {loc.locationType.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2 text-xs">
                      {loc.isSellable ? (
                        <span className="text-emerald-700 font-medium">Sellable</span>
                      ) : (
                        <span className="text-rose-600 font-medium">Non-sellable</span>
                      )}
                      <span className="text-slate-300">•</span>
                      {loc.isReceivable ? (
                        <span className="text-emerald-700 font-medium">Receivable</span>
                      ) : (
                        <span className="text-rose-600 font-medium">Non-receivable</span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    {loc.isActive ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-slate-400 text-xs font-medium">
                        <XCircle className="w-3.5 h-3.5" /> Archived
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        title="View stock in this location"
                        onClick={() => handleOpenStockModal(loc)}
                        className="p-1.5 hover:bg-slate-100 text-slate-600 hover:text-slate-900 rounded-lg transition-colors"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        title="View movement history"
                        onClick={() => handleOpenHistoryModal(loc)}
                        className="p-1.5 hover:bg-slate-100 text-slate-600 hover:text-slate-900 rounded-lg transition-colors"
                      >
                        <History className="w-4 h-4" />
                      </button>
                      <button
                        title="Edit location"
                        onClick={() => openEditModal(loc)}
                        className="p-1.5 hover:bg-slate-100 text-slate-600 hover:text-slate-900 rounded-lg transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      {loc.isActive && (
                        <button
                          title="Archive location"
                          onClick={() => handleArchiveLocation(loc)}
                          className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition-colors"
                        >
                          <Archive className="w-4 h-4" />
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

      {/* CREATE LOCATION MODAL */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-lg font-bold text-slate-900">Create Stock Location</h3>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleCreateLocation} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Location Code *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. WH-01"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 border rounded-lg text-sm uppercase font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Location Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Central Storeroom"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Location Type</label>
                  <select
                    value={formData.locationType}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        locationType: e.target.value as StockLocationType,
                        // Auto-toggle sellable off for damaged/quarantine
                        isSellable: e.target.value !== 'damaged' && e.target.value !== 'quarantine'
                      })
                    }
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  >
                    <option value="shop_floor">Shop Floor</option>
                    <option value="warehouse">Warehouse</option>
                    <option value="storeroom">Storeroom</option>
                    <option value="damaged">Damaged (Non-Sellable)</option>
                    <option value="quarantine">Quarantine (Non-Sellable)</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Parent Location</label>
                  <select
                    value={formData.parentLocationId || ''}
                    onChange={(e) => setFormData({ ...formData, parentLocationId: e.target.value || null })}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  >
                    <option value="">None (Top-Level Location)</option>
                    {locations
                      .filter((l) => l.isActive)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name} ({l.code})
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t">
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isDefault}
                    onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>Set as Default Branch Stock Location</span>
                </label>

                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isSellable}
                    disabled={formData.locationType === 'damaged' || formData.locationType === 'quarantine'}
                    onChange={(e) => setFormData({ ...formData, isSellable: e.target.checked })}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>Sellable (Counter & POS sales permitted)</span>
                </label>

                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isReceivable}
                    onChange={(e) => setFormData({ ...formData, isReceivable: e.target.checked })}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>Receivable (Supplier purchases & intake permitted)</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 border rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-sm"
                >
                  Create Location
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT LOCATION MODAL */}
      {isEditModalOpen && activeLocation && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-lg font-bold text-slate-900">Edit Stock Location</h3>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleUpdateLocation} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Location Code *</label>
                  <input
                    type="text"
                    required
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 border rounded-lg text-sm uppercase font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Location Name *</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Location Type</label>
                  <select
                    value={formData.locationType}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        locationType: e.target.value as StockLocationType,
                        isSellable: e.target.value !== 'damaged' && e.target.value !== 'quarantine'
                      })
                    }
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  >
                    <option value="shop_floor">Shop Floor</option>
                    <option value="warehouse">Warehouse</option>
                    <option value="storeroom">Storeroom</option>
                    <option value="damaged">Damaged (Non-Sellable)</option>
                    <option value="quarantine">Quarantine (Non-Sellable)</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Parent Location</label>
                  <select
                    value={formData.parentLocationId || ''}
                    onChange={(e) => setFormData({ ...formData, parentLocationId: e.target.value || null })}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  >
                    <option value="">None (Top-Level Location)</option>
                    {locations
                      .filter((l) => l.id !== activeLocation.id && l.isActive)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name} ({l.code})
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t">
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isDefault}
                    onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>Default Branch Stock Location</span>
                </label>

                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isSellable}
                    disabled={formData.locationType === 'damaged' || formData.locationType === 'quarantine'}
                    onChange={(e) => setFormData({ ...formData, isSellable: e.target.checked })}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>Sellable (Sales allowed)</span>
                </label>

                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isReceivable}
                    onChange={(e) => setFormData({ ...formData, isReceivable: e.target.checked })}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>Receivable (Purchases & transfers allowed)</span>
                </label>

                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isActive}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>Active Location</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 border rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-sm"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TRANSFER STOCK MODAL */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-bold text-slate-900">Transfer Stock Between Locations</h3>
              </div>
              <button
                onClick={() => setIsTransferModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleExecuteTransfer} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Source Location *</label>
                  <select
                    value={transferData.sourceLocationId}
                    onChange={(e) => setTransferData({ ...transferData, sourceLocationId: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                    required
                  >
                    <option value="">Select Source</option>
                    {locations
                      .filter((l) => l.isActive)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name} ({l.code})
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Destination Location *</label>
                  <select
                    value={transferData.destinationLocationId}
                    onChange={(e) =>
                      setTransferData({ ...transferData, destinationLocationId: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                    required
                  >
                    <option value="">Select Destination</option>
                    {locations
                      .filter((l) => l.isActive && l.isReceivable && l.id !== transferData.sourceLocationId)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name} ({l.code})
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Product *</label>
                <select
                  value={transferData.productId}
                  onChange={(e) => setTransferData({ ...transferData, productId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  required
                >
                  <option value="">Select Product to Transfer</option>
                  {availableProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (SKU: {p.sku || p.id}) - Stock: {p.currentStock || 0}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Transfer Quantity *</label>
                <input
                  type="number"
                  min="0.001"
                  step="any"
                  value={transferData.quantity}
                  onChange={(e) => setTransferData({ ...transferData, quantity: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Notes / Reason</label>
                <input
                  type="text"
                  placeholder="e.g. Replenish sales floor display from storeroom"
                  value={transferData.notes}
                  onChange={(e) => setTransferData({ ...transferData, notes: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setIsTransferModalOpen(false)}
                  className="px-4 py-2 border rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-sm shadow-sm"
                >
                  Execute Transfer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW STOCK MODAL */}
      {isStockModalOpen && activeLocation && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-xl">
            <div className="p-6 border-b flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Inventory at {activeLocation.name}</h3>
                <p className="text-xs text-slate-500 font-mono">Location Code: {activeLocation.code}</p>
              </div>
              <button
                onClick={() => setIsStockModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 border-b bg-slate-50">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search products in this location..."
                  value={stockSearch}
                  onChange={(e) => setStockSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="bg-slate-50 border-b text-slate-700 font-semibold text-xs uppercase tracking-wider">
                  <tr>
                    <th className="py-2.5 px-3">Product</th>
                    <th className="py-2.5 px-3">SKU</th>
                    <th className="py-2.5 px-3 text-right">On Hand</th>
                    <th className="py-2.5 px-3 text-right">Reserved</th>
                    <th className="py-2.5 px-3 text-right">Available</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {locationBalances.filter(
                    (b) =>
                      !stockSearch ||
                      b.productName?.toLowerCase().includes(stockSearch.toLowerCase()) ||
                      b.productSku?.toLowerCase().includes(stockSearch.toLowerCase())
                  ).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-slate-400">
                        No products currently stored in this location.
                      </td>
                    </tr>
                  ) : (
                    locationBalances
                      .filter(
                        (b) =>
                          !stockSearch ||
                          b.productName?.toLowerCase().includes(stockSearch.toLowerCase()) ||
                          b.productSku?.toLowerCase().includes(stockSearch.toLowerCase())
                      )
                      .map((bal) => (
                        <tr key={bal.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3 font-medium text-slate-900">{bal.productName}</td>
                          <td className="py-2.5 px-3 font-mono text-xs">{bal.productSku || '—'}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-medium text-slate-900">
                            {(bal.onHandScaled / 1000).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-amber-600">
                            {(bal.reservedScaled / 1000).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-600">
                            {(bal.availableScaled / 1000).toFixed(2)}
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t bg-slate-50 flex justify-end">
              <button
                onClick={() => setIsStockModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-medium rounded-lg text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW MOVEMENT HISTORY MODAL */}
      {isHistoryModalOpen && activeLocation && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-xl">
            <div className="p-6 border-b flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Stock Movement Audit Trail</h3>
                <p className="text-xs text-slate-500 font-mono">Location: {activeLocation.name} ({activeLocation.code})</p>
              </div>
              <button
                onClick={() => setIsHistoryModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="bg-slate-50 border-b text-slate-700 font-semibold text-xs uppercase tracking-wider">
                  <tr>
                    <th className="py-2.5 px-3">Date / Time</th>
                    <th className="py-2.5 px-3">Product</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3 text-right">Qty</th>
                    <th className="py-2.5 px-3 text-right">Balance</th>
                    <th className="py-2.5 px-3">Reason / Ref</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {locationMovements.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-slate-400">
                        No recorded movements for this location yet.
                      </td>
                    </tr>
                  ) : (
                    locationMovements.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 text-xs text-slate-500 whitespace-nowrap">
                          {new Date(m.created_at).toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-slate-900">{m.product_name}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                              m.movement_type.includes('TRANSFER_IN') || m.movement_type.includes('PURCHASE')
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-rose-50 text-rose-700'
                            }`}
                          >
                            {m.movement_type}
                          </span>
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right font-mono font-medium ${
                            m.quantity >= 0 ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-800">{m.new_stock}</td>
                        <td className="py-2.5 px-3 text-xs text-slate-500 truncate max-w-[200px]" title={m.reason}>
                          {m.reason || m.reference_type || '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t bg-slate-50 flex justify-end">
              <button
                onClick={() => setIsHistoryModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-medium rounded-lg text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

