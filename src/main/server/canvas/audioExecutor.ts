import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CanvasAudioParams, CanvasNode } from '../../../shared/canvas';
import type { CanvasStore } from '../storage/canvasStore';
import type { ProviderStore } from '../storage/providerStore';
import { getCanvasChannel } from './channel';
import { canvasAssetsDir } from './imageExecutor';
import { resolveMentions } from '../../../shared/resolveMentions';
import { getAudioDriver, type AudioGenerateParams } from './audioDrivers';

export async function runAudioNode(options: {
  canvasStore: CanvasStore;
  providerStore: ProviderStore;
  dataRoot: string;
  canvasId: string;
  node: CanvasNode;
  providerId?: string;
}): Promise<void> {
  const { canvasStore, providerStore, dataRoot, canvasId, node } = options;
  const channel = getCanvasChannel(canvasId);

  const params = (node.params || {}) as CanvasAudioParams & {
    providerId?: string;
    voiceId?: string;
    speed?: number;
    pitch?: number;
    vol?: number;
    emotion?: string;
  };

  let promptText = (typeof params.prompt === 'string' ? params.prompt : '').trim();

  // If prompt is empty, inherit from upstream note or agent node
  if (!promptText) {
    const upstream = canvasStore.upstreamNodes(canvasId, node.id);
    for (const u of upstream) {
      if (u.type === 'note') {
        const np = u.params as { content?: string } | undefined;
        if (np?.content?.trim()) {
          promptText = np.content.trim();
          break;
        }
      } else if (u.type === 'agent') {
        const ap = u.output as { text?: string } | undefined;
        if (ap?.text?.trim()) {
          promptText = ap.text.trim();
          break;
        }
      }
    }
  }

  // Resolve @-mentions if any
  if (promptText.includes('@')) {
    const candidates = (canvasStore.getSnapshot(canvasId)?.nodes ?? [])
      .filter((u) => u.id !== node.id && u.type !== 'anchor')
      .map((u) => {
        let text: string | undefined;
        if (u.type === 'note') {
          text = (u.params as { content?: string } | undefined)?.content;
        } else if (u.type === 'agent') {
          text = (u.output as { text?: string } | undefined)?.text;
        }
        return {
          id: u.id,
          label: u.title || '',
          assets: u.output?.assets ?? [],
          text,
        };
      });
    const { resolvedPrompt } = resolveMentions(promptText, candidates);
    promptText = resolvedPrompt;
  }

  if (!promptText) {
    promptText = '欢迎使用 Reizo 智能多模态创作平台';
  }

  // Resolve provider
  const targetProviderId = options.providerId || params.providerId;
  let providerConfig = targetProviderId ? await providerStore.getByIdWithSecret(targetProviderId) : null;

  if (!providerConfig) {
    const catalog = await providerStore.getPublicCatalog('audio');
    const defaultId = catalog.defaultProviderByCategory.audio || catalog.providers[0]?.id;
    if (defaultId) {
      providerConfig = await providerStore.getByIdWithSecret(defaultId);
    }
  }

  const driverType = providerConfig?.driverType || 'mock';
  const driver = getAudioDriver(driverType);

  // Set running state
  const running = canvasStore.updateNode(canvasId, node.id, { runState: 'running', output: null });
  if (running) {
    channel.broadcast(running.rev, { type: 'run_state', id: node.id, runState: 'running' });
    channel.broadcast(running.rev, { type: 'node_updated', node: running.node });
  }

  try {
    const generateParams: AudioGenerateParams = {
      prompt: promptText,
      model: params.model || (providerConfig?.sampleParams.model as string),
      voiceId: params.voiceId || (providerConfig?.sampleParams.voice_id as string) || (providerConfig?.sampleParams.voice as string),
      speed: typeof params.speed === 'number' ? params.speed : (providerConfig?.sampleParams.speed as number) ?? 1.0,
      pitch: typeof params.pitch === 'number' ? params.pitch : (providerConfig?.sampleParams.pitch as number) ?? 0,
      vol: typeof params.vol === 'number' ? params.vol : (providerConfig?.sampleParams.vol as number) ?? 1.0,
      emotion: params.emotion || (providerConfig?.sampleParams.emotion as string),
      format: params.format || 'mp3',
    };

    const result = await driver.synthesize(generateParams, providerConfig?.credentials ?? {});

    const dir = canvasAssetsDir(dataRoot, canvasId);
    await mkdir(dir, { recursive: true });

    const ext = result.format || 'mp3';
    const filename = `${node.id}-${Date.now().toString(36)}.${ext}`;
    const absPath = path.join(dir, filename);
    await writeFile(absPath, result.audioBuffer);

    const relPath = `${canvasId}/${filename}`;

    const done = canvasStore.updateNode(canvasId, node.id, {
      runState: 'done',
      output: { assets: [relPath] },
    });
    if (done) {
      channel.broadcast(done.rev, { type: 'run_state', id: node.id, runState: 'done' });
      channel.broadcast(done.rev, { type: 'node_updated', node: done.node });
    }
  } catch (err: any) {
    const errMsg = err?.message || '音频生成失败';
    const failed = canvasStore.updateNode(canvasId, node.id, {
      runState: 'error',
      output: { error: errMsg },
    });
    if (failed) {
      channel.broadcast(failed.rev, { type: 'run_state', id: node.id, runState: 'error' });
      channel.broadcast(failed.rev, { type: 'node_updated', node: failed.node });
    }
  }
}
