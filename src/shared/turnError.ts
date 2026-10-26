/**
 * What a failed model call means for the person using the app: a plain title, what to do next, and the one action
 * that fixes it. Rule-based on the HTTP status and the wording providers use, so it works with any OpenAI-compatible
 * gateway and costs nothing. The raw provider text is kept separately for people who want to copy it.
 */
export type TurnErrorKind =
  | 'region_blocked'
  | 'auth'
  | 'quota'
  | 'forbidden'
  | 'rate_limited'
  | 'model_not_found'
  | 'content_filtered'
  | 'context_too_long'
  | 'payload_too_large'
  | 'timeout'
  | 'capacity'
  | 'overloaded'
  | 'upstream'
  | 'network'
  | 'unknown';

/** The one button an error card offers. The UI maps each to something it can do. */
export type TurnErrorAction = 'retry' | 'open_providers' | 'switch_model' | 'compact_session' | 'new_session' | 'none';

export interface TurnErrorPresentation {
  kind: TurnErrorKind;
  title: string;
  /** What to do, in one sentence. */
  hint: string;
  action: TurnErrorAction;
  retryable: boolean;
}

const PRESENTATIONS: Record<TurnErrorKind, Omit<TurnErrorPresentation, 'kind'>> = {
  region_blocked: { title: '当前网络地区不被模型服务支持', hint: '这不是密钥的问题。请检查代理 / 网络出口，或换一个在你所在地区可用的模型服务。', action: 'open_providers', retryable: false },
  auth: { title: 'API 密钥无效或已过期', hint: '到「设置 → 模型」重新填写这个服务的密钥。', action: 'open_providers', retryable: false },
  quota: { title: '账户余额不足或额度用完', hint: '到模型服务的后台充值，或换一个有额度的服务 / 模型。', action: 'open_providers', retryable: false },
  forbidden: { title: '这个密钥没有权限使用该模型', hint: '多半是套餐或权限限制（不一定是密钥错了）。换一个模型，或到服务后台检查权限。', action: 'switch_model', retryable: false },
  rate_limited: { title: '请求太频繁', hint: '这是限流，不是余额问题。稍等几秒再试。', action: 'retry', retryable: true },
  model_not_found: { title: '找不到这个模型', hint: '模型名可能写错，或该服务没有开通它。换一个模型试试。', action: 'switch_model', retryable: false },
  content_filtered: { title: '内容被模型服务的安全策略拦截', hint: '换一种说法，或去掉可能敏感的内容后重试。', action: 'none', retryable: false },
  context_too_long: { title: '对话太长，超出了模型的上限', hint: '先压缩较早的对话再继续，或新开一个对话。', action: 'compact_session', retryable: false },
  payload_too_large: { title: '请求内容太大', hint: '移除较大的附件或图片后重试。', action: 'none', retryable: false },
  timeout: { title: '模型服务响应超时', hint: '可以重试；如果经常超时，换一个更快的模型。', action: 'retry', retryable: true },
  capacity: { title: '这个模型当前满载', hint: '稍后重试，或换一个模型。', action: 'switch_model', retryable: true },
  overloaded: { title: '模型服务当前过载', hint: '稍等一会儿再试。', action: 'retry', retryable: true },
  upstream: { title: '模型服务暂时不可用', hint: '这是服务端的问题，可以重试。', action: 'retry', retryable: true },
  network: { title: '连不上模型服务', hint: '检查网络 / 代理设置后重试。', action: 'retry', retryable: true },
  unknown: { title: '模型请求失败', hint: '可以重试；如果反复出现，把下面的原始信息发给我们。', action: 'retry', retryable: false },
};

const has = (raw: string, pattern: RegExp) => pattern.test(raw);

/** Classify from the HTTP status (when there is one) and the provider's own wording. */
export function classifyTurnError(input: { status?: number; message?: string }): TurnErrorKind {
  const status = input.status;
  const raw = (input.message ?? '').toLowerCase();

  if (has(raw, /unsupported[_ ]country|country[, ]+region[, ]+or territory not supported|region.{0,20}(not supported|blocked|restricted)|not available in your (country|region)|地区.{0,6}(不支持|限制)/)) return 'region_blocked';
  if (has(raw, /insufficient[_ ](quota|balance|funds)|exceeded your current quota|billing|out of credit|余额不足|额度.{0,4}(不足|用完|耗尽)|欠费/) || status === 402) return 'quota';
  if (has(raw, /context[_ ](length|window)|maximum context|too many tokens|prompt is too long|reduce the length|上下文.{0,6}(过长|超)/)) return 'context_too_long';
  if (status === 413 || has(raw, /payload too large|request entity too large|content too large/)) return 'payload_too_large';
  if (has(raw, /content[_ ]?(policy|filter)|safety (system|policy)|responsible ai|moderation|violat\w* (our )?policy|违反.{0,8}(政策|规定)|内容.{0,6}(安全|审核|拦截)/)) return 'content_filtered';
  if (status === 401 || has(raw, /invalid[ _]api[ _]?key|incorrect api key|invalid authentication|unauthorized|api key.{0,10}(expired|invalid|missing)/)) return 'auth';
  if (status === 404 || has(raw, /model.{0,40}(does not exist|not found|not supported)|no such model|unknown model/)) return 'model_not_found';
  if (status === 403) return 'forbidden';
  if (status === 529 || has(raw, /\boverloaded\b/)) return 'overloaded';
  if (has(raw, /at capacity|selected model is at capacity/)) return 'capacity';
  if (status === 429 || has(raw, /rate limit|too many requests/)) return 'rate_limited';
  if (status === 408 || status === 504 || status === 524 || has(raw, /timeout|timed out/)) return 'timeout';
  if (typeof status === 'number' && status >= 500) return 'upstream';
  if (has(raw, /fetch failed|econnreset|enotfound|econnrefused|etimedout|socket hang up|network/)) return 'network';
  return 'unknown';
}

export function presentTurnError(input: { status?: number; message?: string }): TurnErrorPresentation {
  const kind = classifyTurnError(input);
  return { kind, ...PRESENTATIONS[kind] };
}

/**
 * The failure card only has the saved message text. Messages built from a presentation start with its exact title,
 * so the kind (and so the action) can be recovered from the text, including after a restart.
 */
export function turnErrorFromMessage(message: string | null | undefined): TurnErrorPresentation | null {
  if (!message) return null;
  for (const [kind, shown] of Object.entries(PRESENTATIONS) as Array<[TurnErrorKind, Omit<TurnErrorPresentation, 'kind'>]>) {
    if (kind !== 'unknown' && message.startsWith(shown.title)) return { kind, ...shown };
  }
  return null;
}
