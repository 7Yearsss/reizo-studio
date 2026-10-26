import { createHash } from 'node:crypto';
import { tool } from 'ai';
import { z } from 'zod';
import { defaultNodeBox } from '../../../shared/canvas';
import { canvasMentionIds } from '../../../shared/resolveMentions';
import { isCanvasJobTerminal, type CanvasJob } from '../../../shared/canvasJobs';
import { createCanvasApplication } from '../canvas/application';
import { startVideoNode } from '../canvas/videoExecutor';
import { canvasWorkSignal, canvasWorkStopped } from '../canvas/workLifecycle';
import type { CanvasStore } from '../storage/canvasStore';
import type { SettingsStore } from '../storage/settingsStore';
import type { ProviderStore } from '../storage/providerStore';
import { videoModelOptions } from './videoModelOptions';

function videoReceipt(job: CanvasJob, modelName?: string) {
  const params = job.input.params as { prompt?: string; duration?: string; ratio?: string; model?: string } | undefined;
  const ok = !isCanvasJobTerminal(job.status) || job.status === 'succeeded';
  const submissionStatus = job.remoteTask ? 'submitted' : job.submittedAt ? 'unconfirmed' : 'not_submitted';
  const submissionNote = job.remoteTask ? '网关已接收视频任务，生成结果会在当前卡片自动更新。' :
    job.submittedAt ? '网关是否接收本次请求尚未确认，不能声称已提交成功；请勿重复提交。' :
      '视频任务尚未提交到网关，不能声称已提交成功。';
  return { ok,
    canvasId: job.canvasId, nodeId: job.nodeId, jobId: job.id, status: job.status,
    prompt: params?.prompt, duration: params?.duration, ratio: params?.ratio, error: job.error,
    model: job.model ?? params?.model, modelName, providerId: job.providerId,
    submissionStatus, remoteTaskId: job.remoteTask?.taskId, submissionNote,
    summary: job.status === 'succeeded' ? '视频已生成，可在当前对话中播放或带到画布。' :
      !ok ? `视频提交未成功：${job.error || '任务已停止或中断'}。不能声称已提交成功，也不要自动重试。` : submissionNote };
}

/** Chat owns the presentation; the durable media runtime owns execution and recovery. */
export function createVideoTools(options: {
  sessionId: string; dataRoot: string; canvasStore: CanvasStore;
  settingsStore: SettingsStore; providerStore?: ProviderStore;
}) {
  const { sessionId, canvasStore } = options;
  const app = createCanvasApplication(canvasStore);
  return {
    get_video_models: tool({
      description: '读取当前账号或已配置视频服务实际可选的模型、默认项和已知能力。普通视频生成前先调用；使用返回的 question 通过 ask_user 让用户选视频模型，若用户已明确指定则直接匹配。不要编造模型、价格、画幅或时长能力。无可用项时提示登录或配置视频服务，不要用模拟模型冒充真实生成。',
      inputSchema: z.object({}),
      execute: async () => {
        const result = await videoModelOptions(await options.settingsStore.get(), options.providerStore);
        return { ...result, note: result.models.length
          ? '用户未指定视频模型时，用 question 作为 ask_user 的一个问题；选中 label 后将对应 id 和 providerId 原样传入 generate_video。已知的时长和画幅以 support 为准，未知能力不要猜测。'
          : '当前没有已配置且可用的视频模型，请登录 Reizo 并刷新模型目录，或先配置视频服务。' };
      },
    }),
    generate_video: tool({
      description: '在当前对话中直接生成视频。生成中显示加载卡片，完成后原地显示可播放视频；用户可主动带到画布，不要为普通视频需求调用 add_node、run_node 或打开画布。使用已配置的视频模型。工具返回持久任务回执，不代表上游已接收或生成已完成；界面会自动更新结果，不要轮询或重复提交。参考图片可通过 referenceNodeIds 或提示词中的 @[名称](canvas:节点ID) 引用。',
      inputSchema: z.object({
        prompt: z.string().min(1).describe('视频主体、动作、环境和镜头的详细描述'),
        duration: z.enum(['5s', '10s']).optional().describe('从所选模型已知支持的时长中选择'),
        ratio: z.enum(['16:9', '9:16', '1:1']).optional().describe('从所选模型已知支持的画幅中选择'),
        model: z.string().optional().describe('get_video_models 中用户选中的模型 id，不是界面标签'),
        providerId: z.string().optional().describe('所选模型在 get_video_models 中对应的 providerId'),
        referenceNodeIds: z.array(z.string()).optional().describe('本次视频使用的参考图片节点'),
      }),
      execute: async ({ prompt, duration, ratio, model, providerId, referenceNodeIds }, context) => {
        try {
          if (canvasWorkStopped(canvasStore)) throw new Error('应用正在退出，无法开始生成视频');
          if (context?.abortSignal?.aborted) throw new Error('视频生成已停止');
          const cleanPrompt = prompt.trim();
          if (!cleanPrompt) throw new Error('视频提示词不能为空');
          const operation = context?.toolCallId ? `chat-video:${createHash('sha256').update(context.toolCallId).digest('hex')}` : undefined;
          const existingCanvas = canvasStore.findCanvasBySession(sessionId);
          const saved = operation && existingCanvas ? canvasStore.jobs.findByOperationId(existingCanvas.id, `${operation}:job`) : undefined;
          // A changed default, expired credential or newer catalog must not
          // change the identity or inputs of an already admitted generation.
          if (saved) return videoReceipt(saved);
          const settings = await options.settingsStore.get();
          const available = await videoModelOptions(settings, options.providerStore);
          if (!available.models.length) throw new Error('当前没有可用的视频模型，请登录 Reizo 并刷新模型目录，或先配置视频服务');
          const matches = model ? available.models.filter(item => item.id === model && (!providerId || item.providerId === providerId)) : [];
          if (matches.length > 1 && !providerId) throw new Error('此视频模型有多个服务来源，请一并选择视频服务');
          const chosen = model ? matches[0] :
            available.selected ?? (available.models.length === 1 ? available.models[0] : undefined);
          if (!chosen) {
            throw new Error('请选择当前可用的视频模型和服务，再开始生成');
          }
          const selectedModel = chosen?.id ?? model;
          const selectedProvider = chosen?.providerId ?? providerId;
          const support = chosen?.support;
          const supportedDurations = ['5s', '10s'].filter(value => (!support?.minSeconds || parseInt(value) >= support.minSeconds) && (!support?.maxSeconds || parseInt(value) <= support.maxSeconds));
          const selectedDuration = duration ?? supportedDurations[0];
          if (!selectedDuration || !supportedDurations.includes(selectedDuration)) throw new Error('所选视频模型不支持此时长，请重新选择');
          const selectedRatio = ratio ?? (support?.aspectRatios ? support.aspectRatios.find(value => ['16:9', '9:16', '1:1'].includes(value)) : '16:9');
          if (!selectedRatio || support?.aspectRatios && !support.aspectRatios.includes(selectedRatio)) throw new Error('所选视频模型不支持此画幅，请重新选择');
          if (canvasWorkStopped(canvasStore) || context?.abortSignal?.aborted) throw new Error('视频生成已停止');
          const canvas = canvasStore.ensureCanvas(sessionId);
          const node = app.batch(canvas.id, { kind: 'inline_video', prompt: cleanPrompt, duration: selectedDuration, ratio: selectedRatio, model: selectedModel, providerId: selectedProvider, referenceNodeIds }, () => {
            const nodes = canvasStore.getSnapshot(canvas.id).nodes;
            const refs = [...new Set([...(referenceNodeIds ?? []), ...canvasMentionIds(cleanPrompt)])];
            for (const id of refs) if (!nodes.some(n => n.id === id)) throw new Error('参考图片不存在，请重新添加');
            const box = defaultNodeBox('video');
            const created = app.addNode(canvas.id, {
              type: 'video', x: nodes.reduce((right, n) => Math.max(right, n.x + n.w), 0) + 40, y: 60,
              ...box, title: '对话生成视频',
              params: { prompt: cleanPrompt, duration: selectedDuration, ratio: selectedRatio, origin: 'chat',
                ...(selectedModel ? { model: selectedModel } : {}), ...(selectedProvider ? { provider: selectedProvider } : {}) },
            }).node;
            for (const sourceId of refs) {
              const edge = app.addEdge(canvas.id, { sourceId, targetId: created.id, targetHandle: 'reference' });
              if (!edge.edge) throw new Error(`无法添加参考图片：${edge.error}`);
            }
            return created;
          }, operation ? `${operation}:node` : undefined);
          const accepted = startVideoNode({ ...options, canvasId: canvas.id, node,
            providerId: selectedProvider, operationId: operation ? `${operation}:job` : undefined, signal: context?.abortSignal });
          // Await the submission receipt, never the full render. A local job ID
          // alone is not evidence that the gateway accepted a paid generation.
          const hostSignal = canvasWorkSignal(canvasStore);
          await new Promise<void>(resolve => {
            const finish = () => { clearTimeout(timer); hostSignal.removeEventListener('abort', finish); resolve(); };
            const timer = setTimeout(finish, 15_000);
            hostSignal.addEventListener('abort', finish, { once: true });
            if (hostSignal.aborted) finish();
            else void accepted.submitted.then(finish, finish);
          });
          if (canvasWorkStopped(canvasStore)) return { ok: false, canvasId: canvas.id, nodeId: node.id,
            jobId: accepted.job.id, status: 'interrupted', error: '应用正在退出，视频提交结果尚未确认', submissionStatus: 'unconfirmed' };
          const job = canvasStore.jobs.get(accepted.job.id) ?? accepted.job;
          return { ...videoReceipt(job, chosen.name), providerId: job.providerId ?? selectedProvider };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    }),
  };
}
