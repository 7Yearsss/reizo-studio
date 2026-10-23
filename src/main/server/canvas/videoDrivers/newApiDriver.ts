import { VideoPollError, type VideoDriver, type VideoDriverOptions } from './types';
import { providerUrl } from './remoteEndpoints';

function base(options: VideoDriverOptions): string {
  if (!options.apiKey || !options.baseUrl) throw new Error('请刷新 Reizo 账号模型凭据');
  const url = providerUrl(options.baseUrl);
  return url.href.replace(/\/$/, '');
}
const validTask = (id: string) => typeof id === 'string' && id.length > 0 && id.length <= 512 && !/[\s/\\?#]/.test(id) && id !== '.' && id !== '..';
function request(options: VideoDriverOptions, timeout = 60000): RequestInit {
  return { headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
    redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(timeout), ...(options.signal ? [options.signal] : [])]) };
}

/** Unified new-api video surface. All authenticated requests stay on the configured gateway. */
export const newApiDriver: VideoDriver = {
  id: 'new-api', name: 'Reizo 视频', supportsRecovery: true,
  validateRemoteContext: (taskId, context) => {
    try { return validTask(taskId) && typeof context?.baseUrl === 'string' && Boolean(providerUrl(context.baseUrl)); }
    catch { return false; }
  },
  async submit(params, options) {
    const baseUrl = base(options);
    const support = options.videoSupport;
    if (!params.model || !support) throw new Error('视频模型目录尚未同步，请刷新账号状态');
    if (params.endImageBytes || params.cameraMotion && params.cameraMotion !== 'none' || params.camera && Object.values(params.camera).some(value => typeof value === 'number' && value !== 0)) {
      throw new Error('当前模型未确认支持尾帧或运镜参数，请移除这些设置');
    }
    const body: Record<string, unknown> = { model: params.model, prompt: params.prompt };
    const fields = support.fields ?? [];
    const images = [...(params.startImageBytes ? [params.startImageBytes] : []), ...(params.referenceImages ?? []).map(image => image.bytes)]
      .filter((image, index, values) => values.findIndex(other => Buffer.from(other).equals(Buffer.from(image))) === index);
    if (images.length) {
      if (!support.startFrame || images.length > 1 && !support.reference) throw new Error('当前模型未确认支持这些参考图片，请先移除图片');
      if (images.length > (support.reference ? 2 : 1)) throw new Error('当前客户端最多支持此模型的两张参考图');
      const encoded = images.map(bytes => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`);
      if (fields.includes('images')) body.images = encoded;
      else if (fields.includes('input_reference')) body.input_reference = encoded[0];
      else if (fields.includes('image')) body.image = encoded[0];
      else throw new Error('当前视频模型不支持参考图片');
    }
    const seconds = params.duration ? Number.parseInt(params.duration) : undefined;
    if (seconds && support.minSeconds && support.maxSeconds) {
      if (seconds < support.minSeconds || seconds > support.maxSeconds) throw new Error('视频时长超出模型支持范围');
      if (fields.includes('seconds')) body.seconds = String(seconds);
      else if (fields.includes('duration')) body.duration = seconds;
    }
    if (params.ratio && support.aspectRatios?.includes(params.ratio) && fields.includes('aspect_ratio')) body.aspect_ratio = params.ratio;
    const response = await fetch(`${baseUrl}/videos`, { ...request(options), method: 'POST', body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`视频提交失败（HTTP ${response.status}），请检查模型额度与网关配置`);
    const result = await response.json() as { id?: string; task_id?: string };
    const taskId = result.id || result.task_id || '';
    if (!validTask(taskId)) throw new Error('视频网关未返回有效任务编号');
    return { taskId, context: { baseUrl } };
  },
  async poll(taskId, options) {
    const baseUrl = base(options);
    if (!validTask(taskId) || options.context?.baseUrl !== baseUrl) throw new VideoPollError('视频网关已变化，无法安全恢复原任务', false);
    const url = `${baseUrl}/videos/${encodeURIComponent(taskId)}`;
    let response: Response;
    try { response = await fetch(url, request(options)); }
    catch { throw new VideoPollError('视频任务查询暂时失败', true); }
    if (!response.ok) throw new VideoPollError(`视频任务查询失败（HTTP ${response.status}）`, response.status === 429 || response.status >= 500);
    const result = await response.json() as { status?: string; progress?: number; error?: { message?: string }; usage?: unknown };
    if (result.status === 'failed' || result.status === 'cancelled') return { status: 'failed', error: '视频生成失败，请检查网关任务记录' };
    if (result.status === 'completed') {
      const content = await fetch(`${url}/content`, request(options, 120000));
      if (!content.ok) throw new VideoPollError(`视频下载失败（HTTP ${content.status}）`, content.status === 429 || content.status >= 500);
      const bytes = Buffer.from(await content.arrayBuffer());
      if (!bytes.length) throw new VideoPollError('视频网关返回了空文件', false);
      return { status: 'succeed', videoBuffer: bytes, usage: result.usage };
    }
    if (result.status !== 'queued' && result.status !== 'in_progress' && result.status !== 'pending' && result.status !== 'processing') throw new VideoPollError('视频网关返回了未知任务状态', false);
    return { status: result.status === 'queued' || result.status === 'pending' ? 'pending' : 'processing', progress: typeof result.progress === 'number' ? result.progress : undefined };
  },
};
