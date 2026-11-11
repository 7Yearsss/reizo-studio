/** Wire/storage credits remain gateway units. Display only: ¥1 = 300 allowance. */
export const ALLOWANCE_PER_CNY = 300;
export const allowanceAmount = (credits: number | null | undefined) => credits == null ? '—' : (credits * ALLOWANCE_PER_CNY).toLocaleString('zh-CN', { maximumFractionDigits: 4 });
