import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface EditorRuntime {
  source: string;
  node: string;
  browserExecutable: string;
  renderBundle: string;
  renderBundleId: string;
  integrationVersion: number;
  entry: string;
  packaged: boolean;
}

/** Packaged manifests contain only relative paths and never fall back to a checkout. */
export async function loadEditorRuntime(manifest = process.env.REIZO_VIDEO_EDITOR_RUNTIME || path.join(process.cwd(), '.cache/openchatcut-runtime.json')): Promise<EditorRuntime> {
  const config = await readFile(manifest, 'utf8').then(JSON.parse).catch((): null => null);
  if (!config) throw new Error(process.env.REIZO_VIDEO_EDITOR_RUNTIME ? '剪辑引擎资源缺失，请重新安装应用。' : '剪辑引擎尚未准备好。请在项目目录运行 npm run setup:video-editor。');
  if (config.kind === 'packaged') {
    const root = path.dirname(path.resolve(manifest));
    const resolve = (value: unknown): string => {
      if (typeof value !== 'string' || !value || path.isAbsolute(value)) throw new Error('剪辑引擎资源清单无效');
      const target = path.resolve(root, value);
      const relative = path.relative(root, target);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('剪辑引擎资源路径无效');
      return target;
    };
    return { source: root, node: resolve(config.node), browserExecutable: resolve(config.browserExecutable), renderBundle: resolve(config.renderBundle), entry: resolve(config.entry), renderBundleId: config.renderBundleId, integrationVersion: config.integrationVersion, packaged: true };
  }
  if (process.env.REIZO_VIDEO_EDITOR_RUNTIME) throw new Error('安装版剪辑引擎必须使用编译后的资源。');
  if (!config.source || !path.isAbsolute(config.source)) throw new Error('剪辑引擎目录无效，请重新运行 setup:video-editor。');
  return { ...config, entry: path.join(config.source, 'reizo-server.mjs'), packaged: false };
}
