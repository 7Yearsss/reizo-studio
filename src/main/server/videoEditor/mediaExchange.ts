import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { CanvasStore } from '../storage/canvasStore';
import { assetAvailableInCanvas } from '../canvas/assetScope';
import { readCanvasAsset, stageCanvasAssets } from '../canvas/assets';
import { createCanvasApplication } from '../canvas/application';
import { defaultNodeBox } from '../../../shared/canvas';
import type { EditorImportJob, EditorImportResult } from '../../../shared/videoEditor';
import type { CanvasAsset } from '../../../shared/canvasAssets';

export const EDITOR_MEDIA_MAX_BYTES = 256 * 1024 * 1024;
interface Pending {
  job: EditorImportJob; sessionId: string; bytes: Buffer;
  resolve(value: EditorImportResult): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>;
  promise: Promise<EditorImportResult>;
}
const exchanges = new Map<string, EditorMediaExchange>();
export function editorMediaFor(root: string, store: CanvasStore): EditorMediaExchange {
  let exchange = exchanges.get(root);
  if (!exchange) { exchange = new EditorMediaExchange(root, store); exchanges.set(root, exchange); }
  return exchange;
}
export function stopEditorMedia(root: string): void { exchanges.get(root)?.stop(); exchanges.delete(root); }

/** Transfers immutable asset versions, independently of a node's later output selection. */
export class EditorMediaExchange {
  private pending = new Map<string, Pending>();
  private stopped = false;
  constructor(private root: string, private store: CanvasStore) {}
  list(sessionId: string) {
    const canvas = this.store.findCanvasBySession(sessionId);
    if (!canvas) return [];
    const assets = new Map(this.store.assets.list(canvas.id).map((asset) => [asset.id, asset]));
    for (const node of this.store.getNodes(canvas.id)) for (const file of node.output?.assets ?? []) {
      const asset = this.store.assets.findByPath(file);
      if (asset) assets.set(asset.id, asset);
    }
    return [...assets.values()].filter((asset) => asset.kind !== 'mask');
  }
  jobs(sessionId: string, projectId: string): EditorImportJob[] {
    return [...this.pending.values()].filter((p) => p.sessionId === sessionId && p.job.projectId === projectId).map((p) => p.job);
  }
  file(sessionId: string, jobId: string): Buffer {
    const pending = this.pending.get(jobId);
    if (!pending || pending.sessionId !== sessionId) throw new Error('素材传输已结束或不属于当前对话');
    return pending.bytes;
  }
  async import(sessionId: string, projectId: string, assetId: string): Promise<EditorImportResult> {
    if (this.stopped) throw new Error('剪辑素材传输已关闭');
    const canvas = this.store.findCanvasBySession(sessionId);
    const asset = this.store.assets.get(assetId);
    if (!canvas || !asset || asset.kind === 'mask' || !assetAvailableInCanvas(this.store, canvas.id, asset)) throw new Error('素材不在当前对话中，请先在画布中复用该素材');
    if (asset.byteSize > EDITOR_MEDIA_MAX_BYTES) throw new Error('当前素材互通支持最大 256 MB 的单个文件');
    const duplicate = [...this.pending.values()].find((p) => p.sessionId === sessionId && p.job.assetId === assetId);
    if (duplicate) return duplicate.promise;
    const bytes = await readCanvasAsset(this.root, asset.path);
    if (this.stopped) throw new Error('剪辑素材传输已关闭');
    if (bytes.length !== asset.byteSize || createHash('sha256').update(bytes).digest('hex') !== asset.contentHash) throw new Error('素材文件与登记版本不一致，请重新导入');
    // Another caller may have finished reading the same version while we awaited disk I/O.
    const concurrent = [...this.pending.values()].find((p) => p.sessionId === sessionId && p.job.assetId === assetId);
    if (concurrent) return concurrent.promise;
    const queuedBytes = [...this.pending.values()].reduce((sum, pending) => sum + pending.bytes.length, 0);
    if (this.pending.size >= 16 || queuedBytes + bytes.length > 512 * 1024 * 1024) throw new Error('素材传输队列已满，请等待当前传输完成');
    const job: EditorImportJob = { id: randomUUID(), projectId, assetId, contentHash: asset.contentHash, mimeType: asset.mimeType,
      name: `reizo-${asset.id}${path.extname(asset.path)}`, label: asset.name || path.basename(asset.path) };
    let resolve!: Pending['resolve']; let reject!: Pending['reject'];
    const promise = new Promise<EditorImportResult>((yes, no) => { resolve = yes; reject = no; });
    const timer = setTimeout(() => { this.pending.delete(job.id); reject(new Error('素材传输超时，请保持剪辑面板打开；重试会复用已导入的版本')); }, 120_000);
    this.pending.set(job.id, { job, sessionId, bytes, resolve, reject, timer, promise });
    return promise;
  }
  complete(sessionId: string, jobId: string, result: { asset?: EditorImportResult; error?: string }): void {
    const pending = this.pending.get(jobId);
    if (!pending || pending.sessionId !== sessionId) throw new Error('素材传输已结束或不属于当前对话');
    if (!result.error && (!result.asset?.editorAssetId || result.asset.sourceAssetId !== pending.job.assetId)) throw new Error('素材传输回执无效');
    clearTimeout(pending.timer); this.pending.delete(jobId);
    if (result.error) pending.reject(new Error(result.error)); else if (result.asset) pending.resolve(result.asset);
  }
  async saveExport(sessionId: string, projectId: string, filename: string, bytes: Buffer, purpose: 'export' | 'source' = 'export') {
    if (this.stopped) throw new Error('剪辑素材传输已关闭');
    if (!bytes.length || bytes.length > EDITOR_MEDIA_MAX_BYTES) throw new Error('成片必须为 1 字节至 256 MB');
    const ext = path.extname(filename).toLowerCase();
    const formats: Record<string, { mimeType: string; kind: 'video' | 'audio' | 'image'; valid: boolean }> = {
      '.mp4': { mimeType: 'video/mp4', kind: 'video', valid: bytes.subarray(4, 8).toString() === 'ftyp' },
      '.webm': { mimeType: 'video/webm', kind: 'video', valid: bytes.subarray(0, 4).toString('hex') === '1a45dfa3' },
      '.wav': { mimeType: 'audio/wav', kind: 'audio', valid: bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE' },
      '.mp3': { mimeType: 'audio/mpeg', kind: 'audio', valid: bytes.subarray(0, 3).toString() === 'ID3' || bytes[0] === 255 && (bytes[1] & 224) === 224 },
    };
    if (purpose === 'source') Object.assign(formats, {
      '.png': { mimeType: 'image/png', kind: 'image', valid: bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' },
      '.jpg': { mimeType: 'image/jpeg', kind: 'image', valid: bytes.subarray(0, 3).toString('hex') === 'ffd8ff' },
      '.jpeg': { mimeType: 'image/jpeg', kind: 'image', valid: bytes.subarray(0, 3).toString('hex') === 'ffd8ff' },
      '.webp': { mimeType: 'image/webp', kind: 'image', valid: bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' },
      '.gif': { mimeType: 'image/gif', kind: 'image', valid: /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString()) },
      '.mov': { mimeType: 'video/quicktime', kind: 'video', valid: bytes.subarray(4, 8).toString() === 'ftyp' },
      '.m4a': { mimeType: 'audio/mp4', kind: 'audio', valid: bytes.subarray(4, 8).toString() === 'ftyp' },
      '.ogg': { mimeType: 'audio/ogg', kind: 'audio', valid: bytes.subarray(0, 4).toString() === 'OggS' },
      '.flac': { mimeType: 'audio/flac', kind: 'audio', valid: bytes.subarray(0, 4).toString() === 'fLaC' },
    });
    const format = formats[ext];
    if (!format?.valid) throw new Error(purpose === 'source' ? '素材格式暂不支持，或文件内容与扩展名不符' : '仅支持有效的 MP4、WebM、WAV 或 MP3 成片');
    const canvas = this.store.ensureCanvas(sessionId);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const app = createCanvasApplication(this.store);
    const request = { kind: `editor_${purpose}`, projectId, contentHash: hash };
    const operationId = `editor-${purpose}:${projectId}:${hash}`;
    const replay = app.replay<CanvasAsset>(canvas.id, request, operationId);
    if (replay) {
      const asset = this.store.assets.get(replay.id);
      if (!asset) throw new Error('已保存的素材记录已不存在，请检查当前画布');
      return asset;
    }
    // Local sources reuse accessible original identities. Exports have their own durable receipts;
    // editable user tags must not make a source file look like a delivered export.
    const existing = () => purpose === 'source' ? this.list(sessionId).find((asset) => asset.contentHash === hash) : undefined;
    const previous = existing();
    if (previous) return previous;
    const staged = await stageCanvasAssets(this.root, canvas.id, [{ name: `edited${ext}`, bytes, ...format }]);
    try {
      if (this.stopped) throw new Error('剪辑素材传输已关闭');
      staged.prepareCommit();
      const saved = app.batch(canvas.id, request, () => {
        const duplicate = existing();
        if (duplicate) return duplicate;
        const name = path.basename(filename).slice(0, 120);
        const { node } = app.addNode(canvas.id, { type: format.kind, title: name, x: 40, y: 40 + this.store.getNodes(canvas.id).length * 40,
          ...defaultNodeBox(format.kind), params: { prompt: '' } });
        const asset = this.store.assets.register({ ...staged.files[0], canvasId: canvas.id, nodeId: node.id, source: 'imported' });
        const saved = this.store.assets.updateMetadata(asset.id, { name, folder: purpose === 'source' ? '剪辑素材' : '剪辑成片', tags: ['OpenChatCut', projectId] });
        app.updateNode(canvas.id, node.id, { runState: 'done', output: { assets: [asset.path], activeAssetIndex: 0,
          resultSet: [{ asset: asset.path, assetId: asset.id, createdAt: asset.createdAt }] } });
        app.afterCommit(() => staged.keep());
        return saved;
      }, operationId);
      return this.store.assets.get(saved.id) ?? saved;
    } finally { await staged.discard(); }
  }
  stop(): void {
    this.stopped = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('剪辑素材传输已关闭')); }
    this.pending.clear();
  }
}
