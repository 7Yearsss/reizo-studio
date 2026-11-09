import { expect, it } from 'vitest';
import { creditAmount, AccountBillingQuerySchema } from './accountBilling';
it('keeps unknown charges distinct from explicit zero and small settled credits', () => {
  expect(creditAmount(null)).toBe('—'); expect(creditAmount(0)).toBe('0'); expect(creditAmount(0.000002)).toBe('0.000002');
});
it('bounds paging and scope inputs before any account network access', () => {
  expect(AccountBillingQuerySchema.safeParse({ page: 0 }).success).toBe(false);
  expect(AccountBillingQuerySchema.safeParse({ organizationId: '../other' }).success).toBe(false);
  expect(AccountBillingQuerySchema.safeParse({ type: 'consume', page: 2 }).success).toBe(true);
});
