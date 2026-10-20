import { afterEach, describe, expect, it } from 'vitest';
import type { MakerOptions } from '@electron-forge/maker-base';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { finishSquirrelResources } from '../../../../scripts/offline-squirrel-maker';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const options = (makeDir: string) => ({ makeDir, targetPlatform: 'win32', targetArch: 'x64', appName: 'Reizo Studio', packageJSON: { name: 'reizo-studio', version: '0.1.0' } } as MakerOptions);
const failure = (setup: string) => new Error(`Failed to modify resources, command invoked was: 'rcedit.exe "${setup}" --set-file-version 0.1.0'\nFatal error: Unable to commit changes`);

describe('Squirrel final resource recovery', () => {
  it('does not convert another build failure into a successful artifact', async () => {
    expect(await finishSquirrelResources(options('missing-build'), new Error('Unable to extract package'))).toBeNull();
    expect(await finishSquirrelResources(options('missing-build'), failure('another-build/Setup.exe'))).toBeNull();
  });

  it('refuses a release package whose bytes no longer match RELEASES', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reizo-installer-recovery-'));
    temporary.push(dir);
    const out = path.resolve(dir, 'squirrel.windows/x64');
    await mkdir(out, { recursive: true });
    const name = 'reizo_studio-0.1.0-full.nupkg';
    await writeFile(path.join(out, name), 'corrupt');
    await writeFile(path.join(out, 'RELEASES'), `${'0'.repeat(40)} ${name} 7\n`);
    const setup = path.join(out, 'Setup.exe');
    await writeFile(setup, 'preserve unfinished installer');
    await expect(finishSquirrelResources(options(dir), failure(setup))).rejects.toThrow('checksum mismatch');
    expect(await readFile(setup, 'utf8')).toBe('preserve unfinished installer');
  });
});
