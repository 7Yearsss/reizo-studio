/** Status text while the app retries a stalled reply on its own: says which attempt this is, so it never looks stuck. */
export function autoRetryLabel(attempt: number, limit: number): string {
  return `上游超时，正在自动重试（第 ${Math.min(attempt, limit)}/${limit} 次）…`;
}
