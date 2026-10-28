import { describe, it, expect } from 'vitest';
import { IPC_CHANNELS } from '../../src/shared/contracts/ipc-channels';
import { LoginSchema, CreateSaleSchema, ProductSchema } from '../../src/shared/validators/schemas';
import { PaymentMethod } from '../../src/shared/constants/accounts';

describe('E2E: IPC Contracts & Validation Schemas', () => {
  it('validates IPC channels integrity', () => {
    expect(IPC_CHANNELS.AUTH_LOGIN).toBe('auth:login');
    expect(IPC_CHANNELS.SALES_CREATE).toBe('sales:create');
    expect(IPC_CHANNELS.INVENTORY_LIST_PRODUCTS).toBe('inventory:list-products');
    expect(IPC_CHANNELS.REPORTS_DAILY_Z).toBe('reports:daily-z');
  });

  it('validates POS Login schema', () => {
    const valid = { username: 'admin', password: 'password123' };
    expect(LoginSchema.safeParse(valid).success).toBe(true);

    const invalid = { username: 'a', password: '1' };
    expect(LoginSchema.safeParse(invalid).success).toBe(false);
  });

  it('validates POS Sale request schema', () => {
    const validSale = {
      cashierId: 1,
      paymentMethod: PaymentMethod.CASH,
      amountPaid: 5000,
      items: [
        {
          productId: 1,
          unitName: 'Piece',
          quantity: 1,
          conversionFactor: 1,
          unitPrice: 5000,
          costPrice: 3000,
          discountPercent: 0,
          discountAmount: 0,
          taxRate: 0,
          isTaxInclusive: true
        }
      ]
    };

    const parsed = CreateSaleSchema.safeParse(validSale);
    expect(parsed.success).toBe(true);

    // Empty items must fail
    const invalidSale = { ...validSale, items: [] };
    expect(CreateSaleSchema.safeParse(invalidSale).success).toBe(false);
  });
});

