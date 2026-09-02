/**
 * Turn a raw provider error from an image / video / audio generation into one
 * clean, localised sentence plus enough structure for the UI to decide
 * whether a "retry" button is honest.
 *
 * `retryable` is deliberately tri-state: `undefined` means the producer did
 * not say — only an explicit `false` licenses telling a user that retrying is
 * pointless.
 */
export type MediaErrorCode =
  | 'safety_rejection'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'bad_request'
  | 'auth'
  | 'timeout'
  | 'network'
  | 'server'
  | 'unknown';

export interface MediaError {
  code: MediaErrorCode;
  /** What the provider objected to, when it says. */
  subject: 'prompt' | 'input_image' | 'account' | 'unknown';
  retryable?: boolean;
  /** One localised sentence, safe to show as-is. */
  message: string;
  /** The original text, for logs / "details". */
  raw: string;
}

const MESSAGES: Record<MediaErrorCode, (subject: MediaError['subject']) => string> = {
  safety_rejection: (s) =>
    s === 'input_image'
      ? '生成失败：内容安全策略拒绝了这张输入图片。换一张参考图再试。'
      : '生成失败：内容安全策略拒绝了这个提示词。调整措辞后重试。',
  rate_limited: () => '请求过于频繁，已被限流。稍等片刻再试。',
  quota_exceeded: () => '生成失败：账户额度或配额已用尽。',
  bad_request: (s) =>
    s === 'input_image'
      ? '生成失败：输入图片无效（格式或尺寸不支持）。'
      : '生成失败：请求参数无效。检查提示词和尺寸设置。',
  auth: () => '生成失败：API Key 无效或缺失。在设置中检查。',
  timeout: () => '生成超时。稍后重试。',
  network: () => '网络错误，未能连接到生成服务。',
  server: () => '生成服务暂时不可用（服务端错误）。稍后重试。',
  unknown: () => '生成失败。',
};

const RETRYABLE: Partial<Record<MediaErrorCode, boolean>> = {
  safety_rejection: false,
  quota_exceeded: false,
  auth: false,
  bad_request: false,
  rate_limited: true,
  timeout: true,
  network: true,
  server: true,
};

export function classifyMediaError(err: unknown): MediaError {
  const raw = err instanceof Error ? err.message : String(err ?? 'unknown error');
  const lower = raw.toLowerCase();
  const status =
    (err as { statusCode?: number; status?: number })?.statusCode ??
    (err as { status?: number })?.status ??
    Number(/\b(4\d\d|5\d\d)\b/.exec(raw)?.[1]);

  let subject: MediaError['subject'] = 'unknown';
  if (/input[_ ]?image|reference image|image you (provided|uploaded)/.test(lower)) subject = 'input_image';
  else if (/prompt|text|description/.test(lower)) subject = 'prompt';
  else if (/account|billing|organization|org/.test(lower)) subject = 'account';

  let code: MediaErrorCode = 'unknown';
  if (/safety|content policy|content_policy|moderation|blocked|not allowed|violat|nsfw|sexual|prohibited/.test(lower)) {
    code = 'safety_rejection';
    if (subject === 'unknown') subject = 'prompt';
  } else if (status === 429 || /rate limit|too many requests/.test(lower)) {
    code = 'rate_limited';
  } else if (/quota|insufficient_quota|billing hard limit|exceeded your current quota/.test(lower)) {
    code = 'quota_exceeded';
    subject = 'account';
  } else if (status === 401 || status === 403 || /api key|unauthorized|invalid authentication|incorrect api key/.test(lower)) {
    code = 'auth';
    subject = 'account';
  } else if (status === 400 || /invalid|bad request|unsupported|must be one of|too large|dimensions/.test(lower)) {
    code = 'bad_request';
  } else if (/timeout|timed out|etimedout|deadline/.test(lower)) {
    code = 'timeout';
  } else if (/econnreset|econnrefused|enotfound|network|socket hang up|fetch failed/.test(lower)) {
    code = 'network';
  } else if ((typeof status === 'number' && status >= 500) || /server error|internal error|bad gateway|unavailable/.test(lower)) {
    code = 'server';
  }

  return {
    code,
    subject,
    retryable: RETRYABLE[code],
    message: MESSAGES[code](subject),
    raw,
  };
}
