"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExpenseSchema = exports.StockAdjustmentSchema = exports.SupplierSchema = exports.CustomerSchema = exports.ProductSchema = exports.CreateSaleSchema = exports.CartItemInputSchema = exports.LoginSchema = void 0;
const zod_1 = require("zod");
const accounts_1 = require("../constants/accounts");
exports.LoginSchema = zod_1.z.object({
    username: zod_1.z.string().min(2, 'Username must be at least 2 characters'),
    password: zod_1.z.string().min(3, 'Password must be at least 3 characters')
});
exports.CartItemInputSchema = zod_1.z.object({
    productId: zod_1.z.number().int().positive(),
    unitName: zod_1.z.string().min(1),
    quantity: zod_1.z.number().positive(),
    conversionFactor: zod_1.z.number().positive(),
    unitPrice: zod_1.z.number().int().nonnegative(),
    costPrice: zod_1.z.number().int().nonnegative(),
    discountPercent: zod_1.z.number().min(0).max(100).default(0),
    discountAmount: zod_1.z.number().int().nonnegative().default(0),
    taxRate: zod_1.z.number().min(0).max(100).default(0),
    isTaxInclusive: zod_1.z.boolean().default(false)
});
exports.CreateSaleSchema = zod_1.z.object({
    customerId: zod_1.z.number().int().positive().optional(),
    cashierId: zod_1.z.number().int().positive(),
    items: zod_1.z.array(exports.CartItemInputSchema).min(1, 'At least one item is required in the sale'),
    orderDiscountPercent: zod_1.z.number().min(0).max(100).optional(),
    orderDiscountAmount: zod_1.z.number().int().nonnegative().optional(),
    paymentMethod: zod_1.z.nativeEnum(accounts_1.PaymentMethod),
    amountPaid: zod_1.z.number().int().nonnegative(),
    splitPayments: zod_1.z.array(zod_1.z.object({
        method: zod_1.z.nativeEnum(accounts_1.PaymentMethod),
        amount: zod_1.z.number().int().positive()
    })).optional(),
    notes: zod_1.z.string().optional()
});
exports.ProductSchema = zod_1.z.object({
    id: zod_1.z.number().optional(),
    categoryId: zod_1.z.number().int().positive(),
    name: zod_1.z.string().min(2, 'Product name is required'),
    sku: zod_1.z.string().min(1, 'SKU is required'),
    barcode: zod_1.z.string().min(1, 'Barcode is required'),
    baseUnit: zod_1.z.string().min(1, 'Base unit is required'),
    costPrice: zod_1.z.number().int().nonnegative(),
    sellingPrice: zod_1.z.number().int().positive(),
    currentStock: zod_1.z.number().default(0),
    minStockLevel: zod_1.z.number().default(5),
    taxRate: zod_1.z.number().min(0).max(100).default(0),
    isTaxInclusive: zod_1.z.boolean().default(false),
    isActive: zod_1.z.boolean().default(true)
});
exports.CustomerSchema = zod_1.z.object({
    id: zod_1.z.number().optional(),
    name: zod_1.z.string().min(2, 'Customer name is required'),
    phone: zod_1.z.string().min(4, 'Valid phone number is required'),
    email: zod_1.z.string().email().optional().or(zod_1.z.literal('')),
    address: zod_1.z.string().optional(),
    creditLimit: zod_1.z.number().int().nonnegative().default(0),
    isActive: zod_1.z.boolean().default(true)
});
exports.SupplierSchema = zod_1.z.object({
    id: zod_1.z.number().optional(),
    name: zod_1.z.string().min(2, 'Supplier name is required'),
    contactPerson: zod_1.z.string().optional(),
    phone: zod_1.z.string().min(4, 'Valid phone number is required'),
    email: zod_1.z.string().email().optional().or(zod_1.z.literal('')),
    address: zod_1.z.string().optional(),
    isActive: zod_1.z.boolean().default(true)
});
exports.StockAdjustmentSchema = zod_1.z.object({
    productId: zod_1.z.number().int().positive(),
    movementType: zod_1.z.nativeEnum(accounts_1.StockMovementType),
    quantity: zod_1.z.number().int().positive('Quantity must be greater than zero'),
    reason: zod_1.z.string().min(3, 'Adjustment reason is required'),
    userId: zod_1.z.number().int().positive()
});
exports.ExpenseSchema = zod_1.z.object({
    expenseCategoryId: zod_1.z.number().int().positive(),
    paidFromAccountId: zod_1.z.number().int().positive(),
    amount: zod_1.z.number().int().positive('Expense amount must be positive'),
    recipient: zod_1.z.string().optional(),
    notes: zod_1.z.string().optional()
});
