import { z } from 'zod';

const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const credits = z.number().finite().min(0).max(1e12).nullable();
export const AccountBillingSchema = z.object({
  organization: z.object({ id: z.string().uuid(), name: z.string().max(512) }),
  balance: z.object({ availableCredits: z.number().finite().min(-1e9).max(1e12).nullable(), usedCredits: credits }),
  membership: z.object({id:z.string(),name:z.string(),discount:z.number().positive().max(1),allowance:z.number().nonnegative(),remainingAllowance:z.number().nonnegative(),expiresAt:z.string().datetime()}).nullable().optional(),
  billing: z.object({ creditsPerCny: z.literal(1), plan: z.object({ status: z.literal('not_configured') }), allowBalanceFallback: z.boolean(), settlementMode: z.enum(['legacy_balance', 'reizo']) }),
  usage: z.object({ status: z.enum(['ready', 'unavailable']), page: z.number().int().positive().max(10000), pageSize: z.literal(20), total: counter,
    items: z.array(z.object({ id: z.string().min(1).max(512), model: z.string().max(512), createdAt: z.string().datetime().nullable(), type: z.enum(['consume', 'error']), credits,
      promptTokens: counter, completionTokens: counter, requestId: z.string().max(512).nullable(), tokenName: z.string().max(512), funding: z.literal('unreported') })).max(20) }),
  pricing: z.object({ status: z.enum(['ready', 'unavailable']), updatedAt: z.string().datetime().nullable(), items: z.array(z.object({ model: z.string().max(512), status: z.enum(['priced', 'dynamic', 'unavailable']),
    rates: z.array(z.object({ label: z.string().max(80), unit: z.string().max(80), min: z.number().finite().min(0).max(1e12), max: z.number().finite().min(0).max(1e12) })).max(12) })).max(3000) }),
});
export type AccountBilling = z.infer<typeof AccountBillingSchema>;
export const AccountBillingQuerySchema = z.object({ organizationId: z.string().uuid().optional(), page: z.number().int().positive().max(10000).optional(), type: z.enum(['consume', 'error']).optional(), model: z.string().trim().max(512).optional() }).strict();
export type AccountBillingQuery = z.infer<typeof AccountBillingQuerySchema>;
export const creditAmount = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 8 });
