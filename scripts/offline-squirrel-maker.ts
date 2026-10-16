import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import type { MakerOptions } from '@electron-forge/maker-base';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, rename, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);

/** Retry only the last resource write, after MakerSquirrel has removed its staging copy. */
export async function finishSquirrelResources(options: MakerOptions, error: unknown): Promise<string[] | null> {
  const out = path.resolve(options.makeDir, `squirrel.windows/${options.targetArch}`);
  const setup = path.join(out, 'Setup.exe');
  const message = error instanceof Error ? error.message : '';
  if (options.targetPlatform !== 'win32' || options.targetArch !== 'x64'
    || !message.includes('Failed to modify resources, command invoked was:')
    || !message.includes('Unable to commit changes')
    || !message.toLowerCase().includes(`"${setup.toLowerCase()}"`)) return null;

  const metadata = options.packageJSON;
  // Recovery supports the default, unsigned, stable-version maker only.
  // Signing, delta packages and custom installer options must use their own full path.
  if (typeof metadata.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(metadata.version)
    || typeof metadata.name !== 'string' || !/^[a-z0-9_-]+$/.test(metadata.name)
    || /[\\/]/.test(options.appName)) return null;
  const packageName = `${metadata.name.replace(/-/g, '_')}-${metadata.version}-full.nupkg`;
  const packageFile = path.join(out, packageName);
  const releases = path.join(out, 'RELEASES');
  const entries = (await readFile(releases, 'utf8')).trim().split(/\r?\n/);
  const entry = entries.length === 1 ? /^([a-f0-9]{40})\s+(\S+)\s+(\d+)$/i.exec(entries[0]) : null;
  if (!entry || entry[2] !== packageName || Number(entry[3]) !== (await stat(packageFile)).size) {
    throw new Error('Cannot finalize Squirrel resources: release manifest does not match the package', { cause: error });
  }
  const hash = createHash('sha1');
  for await (const chunk of createReadStream(packageFile)) hash.update(chunk);
  if (hash.digest('hex') !== entry[1].toLowerCase()) {
    throw new Error('Cannot finalize Squirrel resources: package checksum mismatch', { cause: error });
  }
  if ((await stat(setup)).size < 1024 * 1024) throw new Error('Squirrel Setup payload is missing', { cause: error });
  const editorRoot = path.resolve(path.dirname(require.resolve('rcedit')), '..');
  if (JSON.parse(await readFile(path.join(editorRoot, 'package.json'), 'utf8')).version !== '5.0.2') {
    throw new Error('Review the pinned resource-editor recovery after an upgrade', { cause: error });
  }
  const editor = path.join(editorRoot, 'bin/rcedit-x64.exe');
  const author = String(metadata.authors || (typeof metadata.author === 'string' ? metadata.author : metadata.author?.name) || '').replace(/@/g, '');
  const description = String(metadata.description || '');
  console.warn('Retrying completed Squirrel installer resource editing after temporary app staging was removed.');
  await execute(editor, [setup,
    '--set-version-string', 'CompanyName', author,
    '--set-version-string', 'LegalCopyright', metadata.copyright || `Copyright © ${new Date().getFullYear()} ${author}`,
    '--set-version-string', 'FileDescription', description,
    '--set-version-string', 'ProductName', description,
    '--set-file-version', metadata.version, '--set-product-version', metadata.version,
  ], { windowsHide: true, timeout: 120_000 });
  for (const key of ['FileVersion', 'ProductVersion']) {
    const result = await execute(editor, [setup, '--get-version-string', key], { windowsHide: true, timeout: 30_000 });
    if (result.stdout.trim() !== metadata.version) throw new Error(`Installer ${key} verification failed`);
  }
  const destination = path.join(out, `${options.appName}-${metadata.version} Setup.exe`);
  await rename(setup, destination);
  return [releases, destination, packageFile];
}

export class OfflineSquirrelMaker extends MakerSquirrel {
  override async make(options: MakerOptions): Promise<string[]> {
    try {
      return await super.make(options);
    } catch (error) {
      // The base maker's finally has already removed its temporary app directory.
      if (Object.keys(this.config).length === 0) {
        const artifacts = await finishSquirrelResources(options, error);
        if (artifacts) return artifacts;
      }
      throw error;
    }
  }
}
