import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { installSkillHubPackage, safeZipPath } from './skillHub';

function makeZip(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) entries[name] = strToU8(content);
  return zipSync(entries);
}

function stubFetchZip(zip: Uint8Array) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(zip.slice().buffer, { status: 200 })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('safeZipPath', () => {
  it('accepts normal relative paths', () => {
    expect(safeZipPath('SKILL.md')).toBe('SKILL.md');
    expect(safeZipPath('scripts/run.sh')).toBe('scripts/run.sh');
  });

  it('rejects traversal and absolute paths', () => {
    expect(safeZipPath('../evil.md')).toBeNull();
    expect(safeZipPath('a/../../evil.md')).toBeNull();
    expect(safeZipPath('/etc/passwd')).toBeNull();
    expect(safeZipPath('')).toBeNull();
    expect(safeZipPath('dir/')).toBeNull();
  });
});

describe('installSkillHubPackage', () => {
  it('extracts a skill package into <userSkillsDir>/<slug>', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reizo-skills-'));
    stubFetchZip(
      makeZip({
        'SKILL.md': '---\nname: demo\ndescription: hi\n---\nbody',
        'scripts/tool.py': 'print(1)',
        '_meta.json': '{}',
      }),
    );
    const result = await installSkillHubPackage(dir, { slug: 'demo', namespace: 'clawhub_x' });
    expect(result.id).toBe('demo');
    const skill = await readFile(path.join(dir, 'demo', 'SKILL.md'), 'utf8');
    expect(skill).toContain('name: demo');
    const marker = JSON.parse(await readFile(path.join(dir, 'demo', '.skillhub.json'), 'utf8'));
    expect(marker.canonicalName).toBe('@clawhub_x/demo');
  });

  it('updates in place when the same canonical entry is reinstalled', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reizo-skills-'));
    stubFetchZip(makeZip({ 'SKILL.md': '---\nname: demo\n---\nv1' }));
    await installSkillHubPackage(dir, { slug: 'demo', namespace: 'clawhub_x' });
    stubFetchZip(makeZip({ 'SKILL.md': '---\nname: demo\n---\nv2' }));
    const second = await installSkillHubPackage(dir, { slug: 'demo', namespace: 'clawhub_x' });
    expect(second.id).toBe('demo');
    expect(await readFile(path.join(dir, 'demo', 'SKILL.md'), 'utf8')).toContain('v2');
    expect((await readdir(dir)).sort()).toEqual(['demo'].sort());
  });

  it('does not clobber a non-hub directory with the same slug', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reizo-skills-'));
    await mkdir(path.join(dir, 'demo'), { recursive: true });
    await writeFile(path.join(dir, 'demo', 'SKILL.md'), 'manual skill');
    stubFetchZip(makeZip({ 'SKILL.md': '---\nname: demo\n---\nhub' }));
    const result = await installSkillHubPackage(dir, { slug: 'demo', namespace: 'clawhub_x' });
    expect(result.id).not.toBe('demo');
    expect(await readFile(path.join(dir, 'demo', 'SKILL.md'), 'utf8')).toBe('manual skill');
  });

  it('rejects a package without markdown', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reizo-skills-'));
    stubFetchZip(makeZip({ 'a.txt': 'nope' }));
    await expect(installSkillHubPackage(dir, { slug: 'bad', namespace: 'x' })).rejects.toThrow('SKILL.md');
  });
});
