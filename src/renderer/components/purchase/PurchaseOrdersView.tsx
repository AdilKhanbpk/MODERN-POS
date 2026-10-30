import React, { useState, useEffect } from 'react';
import {
  FileText,
  Search,
  Plus,
  RefreshCw,
  CheckCircle2,
  Clock,
  Send,
  PackageCheck,
  Receipt,
  XCircle,
  AlertTriangle,
  Printer,
  ChevronRight,
  Sliders,
  DollarSign,
  Truck,
  Building2,
  Eye,
  Trash2
} from 'lucide-react';
import {
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderStatus,
  OutstandingDeliveryReportItem
} from '../../../shared/types/purchase-order';

export const PurchaseOrdersView: React.FC = () => {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [outstandingReport, setOutstandingReport] = useState<OutstandingDeliveryReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'orders' | 'outstanding'>('orders');

  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);

  // New PO Form
  const [formData, setFormData] = useState({
    supplierId: '',
    expectedDeliveryDate: '',
    paymentTermsDays: 30,
    shippingCost: 0,
    discountAmount: 0,
    otherCharges: 0,
    notes: '',
    submitForApproval: true
  });

  const [formLines, setFormLines] = useState<Array<{
    productId: string;
    purchaseUnitId: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    taxPercent: number;
  }>>([
    { productId: '', purchaseUnitId: '', quantity: 10, unitPrice: 0, discount: 0, taxPercent: 0 }
  ]);

  // Goods Receipt Form
  const [receiptLocationId, setReceiptLocationId] = useState('');
  const [receiptLines, setReceiptLines] = useState<Array<{
    purchaseOrderLineId: string;
    productName: string;
    orderedQty: number;
    alreadyReceivedQty: number;
    outstandingQty: number;
    receivingQty: number;
    batchNumber: string;
    expiryDate: string;
  }>>([]);
  const [managerApprovalOverride, setManagerApprovalOverride] = useState(false);

  // Invoicing Form
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('');
  const [invoiceLines, setInvoiceLines] = useState<Array<{
    purchaseOrderLineId: string;
    productName: string;
    orderedQty: number;
    invoicedQty: number;
    invoicingQty: number;
    unitPrice: number;
  }>>([]);

  const businessId = '00000000-0000-0000-0000-000000000001';

  const loadData = async () => {
    try {
      setLoading(true);
      if (window.posApi) {
        const [supList, prodList, locList, poRes, reportRes] = await Promise.all([
          window.posApi.suppliers?.list() || [],
          window.posApi.inventory?.listProducts() || [],
          (window.posApi as any).stockLocations?.list(businessId) || [],
          (window.posApi as any).purchaseOrders?.search({
            businessId,
            search: searchQuery || undefined,
            status: statusFilter !== 'all' ? (statusFilter as PurchaseOrderStatus) : undefined
          }),
          (window.posApi as any).purchaseOrders?.getOutstandingReport(businessId)
        ]);

        setSuppliers(supList || []);
        setProducts(prodList || []);
        setLocations(locList || []);
        setOrders(poRes?.orders || []);
        setOutstandingReport(reportRes || []);

        if (locList && locList.length > 0 && !receiptLocationId) {
          setReceiptLocationId(locList[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load purchase orders:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [searchQuery, statusFilter]);

  const handleProductChange = async (index: number, productId: string) => {
    const updated = [...formLines];
    updated[index].productId = productId;

    const prod = products.find((p) => String(p.id) === String(productId));
    if (prod) {
      // Lookup last purchase price for this supplier and product
      let lastPriceMinor = null;
      if (formData.supplierId && (window.posApi as any)?.purchaseOrders?.getLastPurchasePrice) {
        lastPriceMinor = await (window.posApi as any).purchaseOrders.getLastPurchasePrice(
          businessId,
          formData.supplierId,
          productId
        );
      }
      const initialPrice = lastPriceMinor != null ? lastPriceMinor / 100 : (prod.costPrice || 0);
      updated[index].unitPrice = initialPrice;
      updated[index].purchaseUnitId = prod.baseUnitId || '00000000-0000-0000-0000-000000000001';
    }
    setFormLines(updated);
  };

  const addLine = () => {
    setFormLines([
      ...formLines,
      { productId: '', purchaseUnitId: '', quantity: 1, unitPrice: 0, discount: 0, taxPercent: 0 }
    ]);
  };

  const removeLine = (index: number) => {
    if (formLines.length === 1) return;
    setFormLines(formLines.filter((_, i) => i !== index));
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!formData.supplierId) {
        alert('Please select a supplier.');
        return;
      }
      const validLines = formLines.filter((l) => l.productId && l.quantity > 0);
      if (validLines.length === 0) {
        alert('Please add at least one valid product line with quantity > 0.');
        return;
      }

      await (window.posApi as any).purchaseOrders?.createOrder(
        {
          businessId,
          supplierId: formData.supplierId,
          expectedDeliveryDate: formData.expectedDeliveryDate || undefined,
          paymentTermsDays: formData.paymentTermsDays,
          discountMinor: Math.round(formData.discountAmount * 100),
          shippingMinor: Math.round(formData.shippingCost * 100),
          otherChargesMinor: Math.round(formData.otherCharges * 100),
          notes: formData.notes,
          submitForApproval: formData.submitForApproval,
          lines: validLines.map((l) => ({
            productId: l.productId,
            orderedQuantityScaled: Math.round(l.quantity * 1000),
            purchaseUnitId: l.purchaseUnitId || '00000000-0000-0000-0000-000000000001',
            unitPriceMinor: Math.round(l.unitPrice * 100),
            lineDiscountMinor: Math.round(l.discount * 100),
            taxRatePercent: l.taxPercent
          }))
        },
        { userId: 1, role: 'MANAGER' }
      );

      setIsCreateModalOpen(false);
      alert('Purchase Order created successfully!');
      loadData();
    } catch (err: any) {
      alert(`Error creating Purchase Order: ${err.message}`);
    }
  };

  const handleApprove = async (poId: string) => {
    try {
      await (window.posApi as any).purchaseOrders?.approveOrder(poId, { userId: 1, role: 'MANAGER' });
      alert('Purchase order approved.');
      loadData();
    } catch (err: any) {
      alert(`Approval error: ${err.message}`);
    }
  };

  const handleMarkSent = async (poId: string) => {
    try {
      await (window.posApi as any).purchaseOrders?.markSent(poId, { userId: 1, role: 'MANAGER' });
      alert('Marked as sent to supplier.');
      loadData();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const openReceiveModal = (po: PurchaseOrder) => {
    setSelectedOrder(po);
    const initialLines = (po.lines || []).map((l) => ({
      purchaseOrderLineId: l.id,
      productName: l.productName || l.productId,
      orderedQty: l.orderedQuantityScaled / 1000,
      alreadyReceivedQty: l.receivedQuantityScaled / 1000,
      outstandingQty: (l.orderedQuantityScaled - l.receivedQuantityScaled) / 1000,
      receivingQty: Math.max(0, (l.orderedQuantityScaled - l.receivedQuantityScaled) / 1000),
      batchNumber: '',
      expiryDate: ''
    }));
    setReceiptLines(initialLines);
    setIsReceiveModalOpen(true);
  };

  const handleConfirmReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder) return;

    try {
      const receivingToPost = receiptLines
        .filter((l) => l.receivingQty > 0)
        .map((l) => ({
          purchaseOrderLineId: l.purchaseOrderLineId,
          receivedQuantityScaled: Math.round(l.receivingQty * 1000),
          batchNumber: l.batchNumber || undefined,
          expiryDate: l.expiryDate || undefined
        }));

      if (receivingToPost.length === 0) {
        alert('Please specify quantity > 0 for at least one line.');
        return;
      }

      await (window.posApi as any).purchaseOrders?.receiveGoods(
        {
          purchaseOrderId: selectedOrder.id,
          stockLocationId: receiptLocationId,
          lines: receivingToPost,
          managerApproved: managerApprovalOverride
        },
        { userId: 1, role: 'MANAGER' }
      );

      setIsReceiveModalOpen(false);
      alert('Goods received successfully! Stock balances updated.');
      loadData();
    } catch (err: any) {
      alert(`Receiving error: ${err.message}`);
    }
  };

  const openInvoiceModal = (po: PurchaseOrder) => {
    setSelectedOrder(po);
    setSupplierInvoiceNumber(`SINV-${Date.now().toString().slice(-6)}`);
    const initialLines = (po.lines || []).map((l) => ({
      purchaseOrderLineId: l.id,
      productName: l.productName || l.productId,
      orderedQty: l.orderedQuantityScaled / 1000,
      invoicedQty: l.invoicedQuantityScaled / 1000,
      invoicingQty: Math.max(0, (l.receivedQuantityScaled - l.invoicedQuantityScaled) / 1000),
      unitPrice: l.unitPriceMinor / 100
    }));
    setInvoiceLines(initialLines);
    setIsInvoiceModalOpen(true);
  };

  const handleConfirmInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder) return;

    try {
      const linesToPost = invoiceLines
        .filter((l) => l.invoicingQty > 0)
        .map((l) => ({
          purchaseOrderLineId: l.purchaseOrderLineId,
          invoicedQuantityScaled: Math.round(l.invoicingQty * 1000),
          invoicedUnitPriceMinor: Math.round(l.unitPrice * 100)
        }));

      if (linesToPost.length === 0) {
        alert('Please specify invoiced quantity > 0.');
        return;
      }

      await (window.posApi as any).purchaseOrders?.recordInvoice(
        {
          purchaseOrderId: selectedOrder.id,
          invoiceNumber: supplierInvoiceNumber,
          lines: linesToPost
        },
        { userId: 1, role: 'MANAGER' }
      );

      setIsInvoiceModalOpen(false);
      alert('Supplier invoice recorded. Payable liability updated.');
      loadData();
    } catch (err: any) {
      alert(`Invoicing error: ${err.message}`);
    }
  };

  const getStatusBadge = (status: PurchaseOrderStatus) => {
    const s = String(status).toLowerCase();
    switch (s) {
      case 'draft':
        return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">Draft</span>;
      case 'pending_approval':
        return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Pending Approval</span>;
      case 'approved':
        return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">Approved</span>;
      case 'sent':
        return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">Sent to Supplier</span>;
      case 'partially_received':
        return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">Partially Received</span>;
      case 'fully_received':
        return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">Fully Received</span>;
      case 'fully_invoiced':
      case 'closed':
        return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-200 text-emerald-900">Closed</span>;
      case 'cancelled':
        return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-800">Cancelled</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
            <Truck className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Purchase Orders & Inbound Tracking</h2>
            <p className="text-sm text-gray-500">
              Procurement planning, approval workflows, partial receipts & supplier invoicing
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setActiveTab(activeTab === 'orders' ? 'outstanding' : 'orders')}
            className={`px-3 py-2 border rounded-lg text-sm font-medium transition ${
              activeTab === 'outstanding'
                ? 'bg-amber-50 border-amber-300 text-amber-800'
                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Clock className="w-4 h-4 inline mr-1" />
            {activeTab === 'outstanding' ? 'View Orders' : 'Outstanding Deliveries'}
          </button>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium shadow-sm transition"
          >
            <Plus className="w-4 h-4 mr-1.5" /> New Purchase Order
          </button>
        </div>
      </div>

      {/* SEARCH AND FILTERS */}
      {activeTab === 'orders' && (
        <div className="flex flex-col sm:flex-row items-center gap-3 bg-white p-3 rounded-lg border border-gray-200">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
            <input
              type="text"
              placeholder="Search by PO Number or Supplier Name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-auto"
          >
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="pending_approval">Pending Approval</option>
            <option value="approved">Approved</option>
            <option value="sent">Sent</option>
            <option value="partially_received">Partially Received</option>
            <option value="fully_received">Fully Received</option>
            <option value="closed">Closed</option>
            <option value="cancelled">Cancelled</option>
          </select>

          <button
            onClick={loadData}
            className="p-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* MAIN ORDERS TABLE */}
      {activeTab === 'orders' ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-gray-600 font-semibold">
                <tr>
                  <th className="px-6 py-3 text-left">PO Number</th>
                  <th className="px-6 py-3 text-left">Supplier</th>
                  <th className="px-6 py-3 text-left">Order Date</th>
                  <th className="px-6 py-3 text-left">Expected Delivery</th>
                  <th className="px-6 py-3 text-left">Total</th>
                  <th className="px-6 py-3 text-left">Status</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-gray-500">
                      Loading purchase orders...
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-gray-500">
                      <FileText className="w-12 h-12 mx-auto text-gray-300 mb-2" />
                      <p className="font-medium text-gray-700">No purchase orders found</p>
                      <p className="text-xs text-gray-400 mt-1">Create an order to initiate procurement.</p>
                    </td>
                  </tr>
                ) : (
                  orders.map((po) => (
                    <tr key={po.id} className="hover:bg-gray-50 transition">
                      <td className="px-6 py-3 font-mono font-bold text-blue-700">
                        {po.purchaseOrderNumber}
                      </td>
                      <td className="px-6 py-3 font-medium text-gray-900">
                        {po.supplierName || `Supplier #${po.supplierId}`}
                      </td>
                      <td className="px-6 py-3 text-gray-600">
                        {po.orderDate ? po.orderDate.substring(0, 10) : 'N/A'}
                      </td>
                      <td className="px-6 py-3 text-gray-600">
                        {po.expectedDeliveryDate || 'N/A'}
                      </td>
                      <td className="px-6 py-3 font-mono font-semibold text-gray-900">
                        Rs. {(po.totalMinor / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-6 py-3">{getStatusBadge(po.status)}</td>
                      <td className="px-6 py-3 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            onClick={() => {
                              setSelectedOrder(po);
                              setIsDetailModalOpen(true);
                            }}
                            className="p-1.5 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-md transition"
                            title="View Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {po.status === 'pending_approval' && (
                            <button
                              onClick={() => handleApprove(po.id)}
                              className="px-2 py-1 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm"
                            >
                              Approve
                            </button>
                          )}

                          {po.status === 'approved' && (
                            <button
                              onClick={() => handleMarkSent(po.id)}
                              className="px-2 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md"
                            >
                              <Send className="w-3.5 h-3.5 inline mr-1" /> Send
                            </button>
                          )}

                          {['approved', 'sent', 'partially_received'].includes(po.status) && (
                            <button
                              onClick={() => openReceiveModal(po)}
                              className="px-2 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md"
                            >
                              <PackageCheck className="w-3.5 h-3.5 inline mr-1" /> Receive
                            </button>
                          )}

                          {['partially_received', 'fully_received'].includes(po.status) && (
                            <button
                              onClick={() => openInvoiceModal(po)}
                              className="px-2 py-1 text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-md"
                            >
                              <Receipt className="w-3.5 h-3.5 inline mr-1" /> Invoice
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
        /* OUTSTANDING DELIVERIES REPORT */
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
            <h3 className="font-bold text-gray-900 flex items-center">
              <Clock className="w-4 h-4 mr-2 text-amber-600" /> Outstanding Supplier Deliveries
            </h3>
            <span className="text-xs text-gray-500">
              {outstandingReport.length} items awaiting physical delivery
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-gray-600 font-semibold text-xs">
                <tr>
                  <th className="px-6 py-3 text-left">PO #</th>
                  <th className="px-6 py-3 text-left">Supplier</th>
                  <th className="px-6 py-3 text-left">Product</th>
                  <th className="px-6 py-3 text-right">Ordered</th>
                  <th className="px-6 py-3 text-right">Received</th>
                  <th className="px-6 py-3 text-right">Remaining</th>
                  <th className="px-6 py-3 text-right">Outstanding Value</th>
                  <th className="px-6 py-3 text-left">Delivery Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {outstandingReport.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-gray-500">
                      No outstanding deliveries. All approved orders are fully received!
                    </td>
                  </tr>
                ) : (
                  outstandingReport.map((item, idx) => (
                    <tr key={idx} className="hover:bg-gray-50 transition">
                      <td className="px-6 py-3 font-mono font-medium text-blue-700">
                        {item.purchaseOrderNumber}
                      </td>
                      <td className="px-6 py-3 text-gray-900">{item.supplierName}</td>
                      <td className="px-6 py-3 font-medium text-gray-800">{item.productName}</td>
                      <td className="px-6 py-3 text-right font-mono">
                        {(item.orderedQuantityScaled / 1000).toFixed(0)} {item.purchaseUnitName}
                      </td>
                      <td className="px-6 py-3 text-right font-mono text-emerald-700">
                        {(item.receivedQuantityScaled / 1000).toFixed(0)}
                      </td>
                      <td className="px-6 py-3 text-right font-mono font-bold text-amber-700">
                        {(item.outstandingQuantityScaled / 1000).toFixed(0)}
                      </td>
                      <td className="px-6 py-3 text-right font-mono">
                        Rs. {(item.outstandingValueMinor / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-6 py-3">
                        {item.isOverdue ? (
                          <span className="text-rose-600 font-semibold text-xs flex items-center">
                            <AlertTriangle className="w-3.5 h-3.5 mr-1" /> Overdue ({item.expectedDeliveryDate})
                          </span>
                        ) : (
                          <span className="text-gray-600 text-xs">{item.expectedDeliveryDate || 'N/A'}</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CREATE PO MODAL */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-lg font-bold text-gray-900 flex items-center">
                <Truck className="w-5 h-5 mr-2 text-blue-600" /> Create Purchase Order
              </h3>
              <button onClick={() => setIsCreateModalOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            <form onSubmit={handleCreateOrder} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Supplier</label>
                  <select
                    required
                    value={formData.supplierId}
                    onChange={(e) => setFormData({ ...formData, supplierId: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white"
                  >
                    <option value="">Select Supplier...</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.supplierCode || s.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Expected Delivery</label>
                  <input
                    type="date"
                    value={formData.expectedDeliveryDate}
                    onChange={(e) => setFormData({ ...formData, expectedDeliveryDate: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Payment Terms (Days)</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.paymentTermsDays}
                    onChange={(e) => setFormData({ ...formData, paymentTermsDays: parseInt(e.target.value, 10) || 0 })}
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                  />
                </div>
              </div>

              {/* Product Lines Section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-bold text-gray-700 uppercase">Product Lines</label>
                  <button
                    type="button"
                    onClick={addLine}
                    className="text-xs text-blue-600 font-semibold hover:text-blue-800 flex items-center"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" /> Add Product Line
                  </button>
                </div>

                <div className="space-y-2">
                  {formLines.map((line, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 bg-gray-50 p-2.5 rounded-lg items-center text-xs">
                      <div className="col-span-5">
                        <select
                          required
                          value={line.productId}
                          onChange={(e) => handleProductChange(idx, e.target.value)}
                          className="w-full border border-gray-300 rounded p-1.5 bg-white text-xs"
                        >
                          <option value="">Select product...</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.sku})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="col-span-2">
                        <input
                          type="number"
                          step="1"
                          min="1"
                          required
                          placeholder="Qty"
                          value={line.quantity}
                          onChange={(e) => {
                            const updated = [...formLines];
                            updated[idx].quantity = parseFloat(e.target.value) || 0;
                            setFormLines(updated);
                          }}
                          className="w-full border border-gray-300 rounded p-1.5 text-xs text-right font-mono"
                        />
                      </div>

                      <div className="col-span-2">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          required
                          placeholder="Unit Price"
                          value={line.unitPrice}
                          onChange={(e) => {
                            const updated = [...formLines];
                            updated[idx].unitPrice = parseFloat(e.target.value) || 0;
                            setFormLines(updated);
                          }}
                          className="w-full border border-gray-300 rounded p-1.5 text-xs text-right font-mono"
                        />
                      </div>

                      <div className="col-span-2 text-right font-mono font-semibold text-gray-800">
                        Rs. {(line.quantity * line.unitPrice).toFixed(2)}
                      </div>

                      <div className="col-span-1 text-center">
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          className="text-gray-400 hover:text-rose-600 transition"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Document Charges & Notes */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t pt-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Discount (Rs.)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.discountAmount}
                    onChange={(e) => setFormData({ ...formData, discountAmount: parseFloat(e.target.value) || 0 })}
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Shipping / Freight (Rs.)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.shippingCost}
                    onChange={(e) => setFormData({ ...formData, shippingCost: parseFloat(e.target.value) || 0 })}
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Other Charges (Rs.)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.otherCharges}
                    onChange={(e) => setFormData({ ...formData, otherCharges: parseFloat(e.target.value) || 0 })}
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Order Notes / Terms</label>
                <textarea
                  rows={2}
                  placeholder="Special delivery instructions, packaging requirements..."
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                />
              </div>

              <div className="flex items-center justify-between border-t pt-3">
                <label className="flex items-center text-xs font-medium text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.submitForApproval}
                    onChange={(e) => setFormData({ ...formData, submitForApproval: e.target.checked })}
                    className="rounded text-blue-600 mr-2"
                  />
                  Submit directly for approval (or auto-approve if under threshold)
                </label>

                <div className="space-x-2">
                  <button
                    type="button"
                    onClick={() => setIsCreateModalOpen(false)}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium shadow-sm"
                  >
                    Create Purchase Order
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* GOODS RECEIPT MODAL */}
      {isReceiveModalOpen && selectedOrder && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-lg font-bold text-gray-900 flex items-center">
                  <PackageCheck className="w-5 h-5 mr-2 text-emerald-600" /> Receive Inbound Goods
                </h3>
                <p className="text-xs text-gray-500 font-mono">PO #{selectedOrder.purchaseOrderNumber}</p>
              </div>
              <button onClick={() => setIsReceiveModalOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            <form onSubmit={handleConfirmReceive} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Receiving Stock Location</label>
                <select
                  required
                  value={receiptLocationId}
                  onChange={(e) => setReceiptLocationId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white"
                >
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200 text-xs">
                  <thead className="bg-gray-50 text-gray-600 font-semibold">
                    <tr>
                      <th className="px-3 py-2 text-left">Product</th>
                      <th className="px-3 py-2 text-right">Ordered</th>
                      <th className="px-3 py-2 text-right">Received</th>
                      <th className="px-3 py-2 text-right">Remaining</th>
                      <th className="px-3 py-2 text-right w-24">Receiving Now</th>
                      <th className="px-3 py-2 text-left w-28">Batch # (Opt)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {receiptLines.map((line, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2 font-medium text-gray-900">{line.productName}</td>
                        <td className="px-3 py-2 text-right font-mono">{line.orderedQty}</td>
                        <td className="px-3 py-2 text-right font-mono text-emerald-700">{line.alreadyReceivedQty}</td>
                        <td className="px-3 py-2 text-right font-mono text-amber-700 font-semibold">{line.outstandingQty}</td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            value={line.receivingQty}
                            onChange={(e) => {
                              const updated = [...receiptLines];
                              updated[idx].receivingQty = parseFloat(e.target.value) || 0;
                              setReceiptLines(updated);
                            }}
                            className="w-full border border-gray-300 rounded p-1 text-right font-mono text-xs"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            placeholder="LOT-101"
                            value={line.batchNumber}
                            onChange={(e) => {
                              const updated = [...receiptLines];
                              updated[idx].batchNumber = e.target.value;
                              setReceiptLines(updated);
                            }}
                            className="w-full border border-gray-300 rounded p-1 text-xs font-mono"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center space-x-2 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
                <input
                  type="checkbox"
                  id="overDelivMgr"
                  checked={managerApprovalOverride}
                  onChange={(e) => setManagerApprovalOverride(e.target.checked)}
                  className="rounded text-amber-600"
                />
                <label htmlFor="overDelivMgr" className="text-xs text-amber-900 font-medium">
                  Manager Override: Permit over-delivery if received quantity exceeds remaining ordered balance
                </label>
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
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium shadow-sm"
                >
                  Confirm Goods Receipt
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SUPPLIER INVOICING MODAL */}
      {isInvoiceModalOpen && selectedOrder && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-lg font-bold text-gray-900 flex items-center">
                  <Receipt className="w-5 h-5 mr-2 text-purple-600" /> Record Supplier Invoice
                </h3>
                <p className="text-xs text-gray-500 font-mono">PO #{selectedOrder.purchaseOrderNumber}</p>
              </div>
              <button onClick={() => setIsInvoiceModalOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            <form onSubmit={handleConfirmInvoice} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Supplier Invoice #</label>
                <input
                  type="text"
                  required
                  value={supplierInvoiceNumber}
                  onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm font-mono"
                />
              </div>

              <div className="border rounded-lg overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200 text-xs">
                  <thead className="bg-gray-50 text-gray-600 font-semibold">
                    <tr>
                      <th className="px-3 py-2 text-left">Product</th>
                      <th className="px-3 py-2 text-right">Invoiced Already</th>
                      <th className="px-3 py-2 text-right">Invoicing Now</th>
                      <th className="px-3 py-2 text-right">Unit Price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {invoiceLines.map((line, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2 font-medium text-gray-900">{line.productName}</td>
                        <td className="px-3 py-2 text-right font-mono">{line.invoicedQty}</td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            value={line.invoicingQty}
                            onChange={(e) => {
                              const updated = [...invoiceLines];
                              updated[idx].invoicingQty = parseFloat(e.target.value) || 0;
                              setInvoiceLines(updated);
                            }}
                            className="w-24 border border-gray-300 rounded p-1 text-right font-mono text-xs"
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          Rs. {line.unitPrice.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-gray-500">
                Note: Recording the invoice updates the supplier payable liability in the general ledger. It does not re-increment physical inventory.
              </p>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsInvoiceModalOpen(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium shadow-sm"
                >
                  Confirm Invoice & Post Payable
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PO DETAILS MODAL */}
      {isDetailModalOpen && selectedOrder && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-lg font-bold text-gray-900 flex items-center">
                  <FileText className="w-5 h-5 mr-2 text-blue-600" /> Purchase Order Details
                </h3>
                <p className="text-xs text-gray-500 font-mono">
                  {selectedOrder.purchaseOrderNumber} — Status: {selectedOrder.status}
                </p>
              </div>
              <button onClick={() => setIsDetailModalOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-gray-50 p-3 rounded-lg text-xs">
              <div>
                <span className="text-gray-500 block">Supplier</span>
                <span className="font-semibold text-gray-900">{selectedOrder.supplierName}</span>
              </div>
              <div>
                <span className="text-gray-500 block">Order Date</span>
                <span className="font-medium text-gray-800">{selectedOrder.orderDate.substring(0, 10)}</span>
              </div>
              <div>
                <span className="text-gray-500 block">Expected Delivery</span>
                <span className="font-medium text-gray-800">{selectedOrder.expectedDeliveryDate || 'N/A'}</span>
              </div>
              <div>
                <span className="text-gray-500 block">Grand Total</span>
                <span className="font-bold text-blue-700 font-mono">
                  Rs. {(selectedOrder.totalMinor / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200 text-xs">
                <thead className="bg-gray-50 text-gray-600 font-semibold">
                  <tr>
                    <th className="px-3 py-2 text-left">Product</th>
                    <th className="px-3 py-2 text-right">Ordered</th>
                    <th className="px-3 py-2 text-right">Received</th>
                    <th className="px-3 py-2 text-right">Invoiced</th>
                    <th className="px-3 py-2 text-right">Unit Price</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {(selectedOrder.lines || []).map((l) => (
                    <tr key={l.id}>
                      <td className="px-3 py-2 font-medium text-gray-900">{l.productName || l.productId}</td>
                      <td className="px-3 py-2 text-right font-mono">{(l.orderedQuantityScaled / 1000).toFixed(0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-emerald-700">{(l.receivedQuantityScaled / 1000).toFixed(0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-purple-700">{(l.invoicedQuantityScaled / 1000).toFixed(0)}</td>
                      <td className="px-3 py-2 text-right font-mono">Rs. {(l.unitPriceMinor / 100).toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">Rs. {(l.lineTotalMinor / 100).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setIsDetailModalOpen(false)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg text-sm font-medium"
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

