import { z } from 'zod';
import { Role } from '../constants/roles-permissions';
import { PaymentMethod, StockMovementType } from '../constants/accounts';

export const LoginSchema = z.object({
  username: z.string().min(2, 'Username must be at least 2 characters'),
  password: z.string().min(3, 'Password must be at least 3 characters')
});

export const CartItemInputSchema = z.object({
  productId: z.number().int().positive(),
  unitName: z.string().min(1),
  quantity: z.number().positive(),
  conversionFactor: z.number().positive(),
  unitPrice: z.number().int().nonnegative(),
  costPrice: z.number().int().nonnegative(),
  discountPercent: z.number().min(0).max(100).default(0),
  discountAmount: z.number().int().nonnegative().default(0),
  taxRate: z.number().min(0).max(100).default(0),
  isTaxInclusive: z.boolean().default(false)
});

export const CreateSaleSchema = z.object({
  customerId: z.number().int().positive().optional(),
  cashierId: z.number().int().positive(),
  items: z.array(CartItemInputSchema).min(1, 'At least one item is required in the sale'),
  orderDiscountPercent: z.number().min(0).max(100).optional(),
  orderDiscountAmount: z.number().int().nonnegative().optional(),
  paymentMethod: z.nativeEnum(PaymentMethod),
  amountPaid: z.number().int().nonnegative(),
  splitPayments: z.array(z.object({
    method: z.nativeEnum(PaymentMethod),
    amount: z.number().int().positive()
  })).optional(),
  notes: z.string().optional()
});

export const ProductSchema = z.object({
  id: z.number().optional(),
  categoryId: z.number().int().positive(),
  name: z.string().min(2, 'Product name is required'),
  sku: z.string().min(1, 'SKU is required'),
  barcode: z.string().min(1, 'Barcode is required'),
  baseUnit: z.string().min(1, 'Base unit is required'),
  costPrice: z.number().int().nonnegative(),
  sellingPrice: z.number().int().positive(),
  currentStock: z.number().default(0),
  minStockLevel: z.number().default(5),
  taxRate: z.number().min(0).max(100).default(0),
  isTaxInclusive: z.boolean().default(false),
  isActive: z.boolean().default(true)
});

export const CustomerSchema = z.object({
  id: z.number().optional(),
  name: z.string().min(2, 'Customer name is required'),
  phone: z.string().min(4, 'Valid phone number is required'),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
  creditLimit: z.number().int().nonnegative().default(0),
  isActive: z.boolean().default(true)
});

export const SupplierSchema = z.object({
  id: z.number().optional(),
  name: z.string().min(2, 'Supplier name is required'),
  contactPerson: z.string().optional(),
  phone: z.string().min(4, 'Valid phone number is required'),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
  isActive: z.boolean().default(true)
});

export const StockAdjustmentSchema = z.object({
  productId: z.number().int().positive(),
  movementType: z.nativeEnum(StockMovementType),
  quantity: z.number().int().positive('Quantity must be greater than zero'),
  reason: z.string().min(3, 'Adjustment reason is required'),
  userId: z.number().int().positive()
});

export const ExpenseSchema = z.object({
  expenseCategoryId: z.number().int().positive(),
  paidFromAccountId: z.number().int().positive(),
  amount: z.number().int().positive('Expense amount must be positive'),
  recipient: z.string().optional(),
  notes: z.string().optional()
});

