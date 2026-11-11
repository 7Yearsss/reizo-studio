export interface AccountPaymentOrder {
  id: string;
  reference: string;
  status: 'pending' | 'crediting' | 'success' | 'failed';
  amount: number;
  currency: string;
  credits: number;
  provider: string;
  paymentMethod: string;
  createdAt: string;
  paidAt: string | null;
  planName?: string;
  allowance?: number;
}
export interface AccountWallet {
  organization: { id: string; name: string };
  balance: { availableCredits: number; currency: string; syncStatus: 'ready' | 'unavailable' };
  canTopup: boolean;
  config: { enabled: boolean; provider: string; currency: string; creditsPerUnit: number; minTopup: number; maxTopup: number;
    amountOptions: number[]; methods: Array<{ type: string; name: string }>; topupDiscount?: number };
  plans?: Array<{id: string;name:string;productId:string;price:number;allowance:number;discount:number;period:'month'}>;
  membership?: {id:string;name:string;discount:number;allowance:number;remainingAllowance:number;expiresAt:string} | null;
  orders: AccountPaymentOrder[];
  order?: AccountPaymentOrder | null;
}
export type AccountTopupInput = { organizationId: string; amount: number; paymentMethod: string; requestId: string; expectedPayMoney?: string } | {organizationId:string;planId:'core'|'plus'|'pro'|'max';requestId:string};
export interface AccountCheckout { order: AccountPaymentOrder; cashierOpened: boolean }
