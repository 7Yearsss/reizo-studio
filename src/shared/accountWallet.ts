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
}
export interface AccountWallet {
  organization: { id: string; name: string };
  balance: { availableCredits: number; currency: string; syncStatus: 'ready' | 'unavailable' };
  canTopup: boolean;
  config: { enabled: boolean; provider: string; currency: string; creditsPerUnit: number; minTopup: number; maxTopup: number;
    amountOptions: number[]; methods: Array<{ type: string; name: string }> };
  orders: AccountPaymentOrder[];
  order?: AccountPaymentOrder | null;
}
export interface AccountTopupInput { organizationId: string; amount: number; paymentMethod: string; requestId: string }
export interface AccountCheckout { order: AccountPaymentOrder; cashierOpened: boolean }
