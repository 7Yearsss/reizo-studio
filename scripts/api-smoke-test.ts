/**
 * Node-only smoke test for the local API layer (src/main/server/**),
 * bypassing Electron entirely. Useful for headless CI/dev sandboxes where a
 * real Chromium GUI can't launch — the `electron` module is stubbed via
 * scripts/electron-stub.cjs (safeStorage only, which is all this layer
 * touches outside a BrowserWindow).
 *
 * Run: node --require ./scripts/electron-stub.cjs -r tsx/cjs scripts/api-smoke-test.ts
 */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/main/server/app';
import { resolveInsideWorkspace } from '../src/main/workspacePath';
import { deleteWorkspacePath, writeWorkspaceFile } from '../src/main/workspaceWrite';
import { grepWorkspace } from '../src/main/workspaceGrep';

async function main() {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'reizo-desktop-test-'));
  const port = 47199;
  const app = createApp({ dataRoot, port });
  let failed = false;

  function check(name: string, ok: boolean, extra?: unknown) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, extra ?? '');
    if (!ok) failed = true;
  }

  async function call(pathname: string, init?: RequestInit) {
    const req = new Request(`http://127.0.0.1:${port}${pathname}`, {
      ...init,
      headers: { host: `127.0.0.1:${port}`, ...(init?.headers ?? {}) },
    });
    return app.fetch(req);
  }

  {
    const res = await app.fetch(
      new Request(`http://127.0.0.1:${port}/api/health`, { headers: { host: 'evil.example:1234' } }),
    );
    check('reject-bad-host', res.status === 403);
  }

  {
    const res = await call('/api/health');
    const body = await res.json();
    check('health', res.status === 200 && body.ok === true, body);
  }

  {
    const res = await call('/api/settings');
    const body = await res.json();
    const openai = body.providers.find((p: { id: string }) => p.id === 'openai');
    check(
      'settings-initial-unset',
      body.appearance === 'system' &&
        body.permissionMode === 'ask' &&
        openai?.hasKey === false &&
        !('openaiApiKey' in body),
      { providerCount: body.providers?.length, openai },
    );
  }

  {
    const res = await call('/api/settings');
    const body = await res.json();
    const reizo = body.providers.find((p: { id: string }) => p.id === 'reizo');
    check(
      'settings-reizo-preset',
      reizo?.name === 'Reizo (Winlume)' &&
        typeof reizo?.baseUrl === 'string' &&
        reizo.baseUrl.includes('v2api.top') &&
        reizo.hasKey === false,
      reizo,
    );
  }

  {
    const put = await call('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: { id: 'openai', apiKey: 'sk-test-123' } }),
    });
    const get = await call('/api/settings');
    const body = await get.json();
    const openai = body.providers.find((p: { id: string }) => p.id === 'openai');
    const serialized = JSON.stringify(body);
    check(
      'settings-set-roundtrip',
      put.status === 200 && openai?.hasKey === true && !serialized.includes('sk-test-123'),
      { hasKey: openai?.hasKey },
    );
  }

  {
    await call('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: { id: 'deepseek', apiKey: 'sk-ds-456' }, activeProviderId: 'deepseek' }),
    });
    const get = await call('/api/settings');
    const body = await get.json();
    const openai = body.providers.find((p: { id: string }) => p.id === 'openai');
    const deepseek = body.providers.find((p: { id: string }) => p.id === 'deepseek');
    check(
      'settings-multi-provider',
      openai?.hasKey === true && deepseek?.hasKey === true && body.activeProviderId === 'deepseek',
      { active: body.activeProviderId },
    );
  }

  {
    await call('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appearance: 'dark', workspacePath: 'C:\\work\\reizo' }),
    });
    const get = await call('/api/settings');
    const body = await get.json();
    check(
      'settings-appearance-workspace',
      body.appearance === 'dark' && body.workspacePath === 'C:\\work\\reizo',
      body,
    );
  }

  let sessionId = '';
  {
    const create = await call('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Test session', workspacePath: 'C:\\work\\reizo' }),
    });
    const { session } = await create.json();
    sessionId = session.id;
    check(
      'session-create',
      create.status === 201 && session.title === 'Test session' && session.workspacePath === 'C:\\work\\reizo',
    );
  }
  {
    const list = await call('/api/sessions');
    const { sessions } = await list.json();
    check('session-list', sessions.length === 1, sessions);
  }
  {
    const get = await call(`/api/sessions/${sessionId}`);
    const { session } = await get.json();
    check('session-get', session.id === sessionId && Array.isArray(session.messages));
  }
  {
    const rename = await call(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed' }),
    });
    const { session } = await rename.json();
    check('session-rename', session.title === 'Renamed');
  }
  {
    const sessionFile = path.join(dataRoot, 'sessions', `${sessionId}.json`);
    const raw = JSON.parse(await readFile(sessionFile, 'utf8')) as {
      messages: { id: string; role: string; content: string; createdAt: string }[];
    };
    const now = new Date().toISOString();
    raw.messages = [
      { id: 'u1', role: 'user', content: 'hello', createdAt: now },
      { id: 'a1', role: 'assistant', content: 'hi', createdAt: now },
      { id: 'u2', role: 'user', content: 'again', createdAt: now },
      { id: 'a2', role: 'assistant', content: 'ok', createdAt: now },
    ];
    await writeFile(sessionFile, JSON.stringify(raw, null, 2), 'utf8');
    const truncated = await call(`/api/sessions/${sessionId}/messages`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ truncateAfterId: 'u2' }),
    });
    const { session } = await truncated.json();
    check(
      'session-truncate',
      truncated.status === 200 && session.messages.length === 2 && session.messages[1].id === 'a1',
      session.messages?.map((m: { id: string }) => m.id),
    );
  }
  {
    const missing = await call(`/api/sessions/${sessionId}/messages`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ truncateAfterId: 'missing' }),
    });
    check('session-truncate-missing', missing.status === 404);
  }
  {
    const res = await call(`/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'x', truncateAfterId: 'nope', providerId: 'openai' }),
    });
    const body = await res.json();
    check('chat-truncate-missing', res.status === 400 && /truncateAfterId/.test(body.error), body);
  }
  {
    const created = await call('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Empty regen' }),
    });
    const { session } = await created.json();
    const res = await call(`/api/sessions/${session.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'retry', regenerate: true, providerId: 'openai' }),
    });
    const body = await res.json();
    check('chat-regenerate-empty', res.status === 400 && /user message/.test(body.error), body);
    await call(`/api/sessions/${session.id}`, { method: 'DELETE' });
  }


  let projectId = '';
  {
    const created = await call('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Desk', description: 'Local', instructions: 'Be terse.' }),
    });
    const body = await created.json();
    projectId = body.project?.id ?? '';
    check('project-create', created.status === 201 && body.project?.name === 'Desk', body);
  }
  {
    const list = await call('/api/projects');
    const body = await list.json();
    check('project-list', Array.isArray(body.projects) && body.projects.some((x: { id: string }) => x.id === projectId));
  }
  {
    const patched = await call(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId }),
    });
    const { session } = await patched.json();
    check('session-assign-project', session.projectId === projectId);
  }
  {
    const list = await call(`/api/sessions?projectId=${encodeURIComponent(projectId)}`);
    const { sessions } = await list.json();
    check('session-list-by-project', sessions.length === 1 && sessions[0].id === sessionId, sessions);
  }
  let artifactId = '';
  {
    const created = await call(`/api/sessions/${sessionId}/artifacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'note.md', content: '# hi', source: 'attachment' }),
    });
    const body = await created.json();
    artifactId = body.artifact?.id ?? '';
    check('artifact-create', created.status === 201 && body.artifact?.kind === 'markdown', body);
  }
  {
    const list = await call(`/api/sessions/${sessionId}/artifacts`);
    const body = await list.json();
    check('artifact-list', body.artifacts?.length === 1 && body.artifacts[0].id === artifactId);
  }
  {
    const get = await call(`/api/artifacts/${artifactId}`);
    const body = await get.json();
    check('artifact-get', body.artifact?.content.includes('# hi'));
  }

  {
    await call('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: { id: 'openai', apiKey: '' }, activeProviderId: 'openai' }),
    });
    const res = await call(`/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello', providerId: 'openai' }),
    });
    const body = await res.json();
    check('chat-requires-key', res.status === 400 && /API key/.test(body.error), body);
  }

  {
    const del = await call(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    const list = await call('/api/sessions');
    const { sessions } = await list.json();
    check('session-delete', del.status === 204 && sessions.length === 0);
  }
  {
    const list = await call(`/api/sessions/${sessionId}/artifacts`);
    check('artifact-session-cleanup', list.status === 404, list.status);
  }
  {
    const del = await call(`/api/projects/${projectId}`, { method: 'DELETE' });
    const list = await call('/api/projects');
    const body = await list.json();
    check('project-delete', del.status === 204 && body.projects.length === 0, body.projects);
  }

  {
    const root = path.resolve('work', 'reizo');
    const inside = resolveInsideWorkspace(root, path.join('src', 'app.ts'));
    check('workspace-inside', inside === path.join(root, 'src', 'app.ts'), inside);
    let escaped = false;
    try {
      resolveInsideWorkspace('C:\\work\\reizo', '..\\Windows\\System32');
    } catch {
      escaped = true;
    }
    check('workspace-escape', escaped);
    let writeEscaped = false;
    try {
      await writeWorkspaceFile('C:\\work\\reizo', '..\\Windows\\evil.txt', 'nope');
    } catch {
      writeEscaped = true;
    }
    check('workspace-write-escape', writeEscaped);
    let deleteEscaped = false;
    try {
      await deleteWorkspacePath('C:\\work\\reizo', '..\\Windows');
    } catch {
      deleteEscaped = true;
    }
    check('workspace-delete-escape', deleteEscaped);
  }

  {
    const grepRoot = await mkdtemp(path.join(tmpdir(), 'reizo-grep-'));
    await writeFile(path.join(grepRoot, 'note.txt'), 'hello reizo agent\nsecond line\n', 'utf8');
    const hits = await grepWorkspace(grepRoot, 'reizo');
    check('workspace-grep', hits.hits.some((h) => h.path === 'note.txt' && h.line === 1), hits);
  }

  {
    await call('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ permissionMode: 'workspace' }),
    });
    const get = await call('/api/settings');
    const body = await get.json();
    check('settings-permission-mode', body.permissionMode === 'workspace', body.permissionMode);
  }

  {
    const skillRoot = await mkdtemp(path.join(tmpdir(), 'reizo-skills-'));
    await mkdir(path.join(skillRoot, 'demo'));
    await writeFile(
      path.join(skillRoot, 'demo', 'SKILL.md'),
      '---\nname: demo\ndescription: Demo skill\n---\nDo the demo.\n',
      'utf8',
    );
    const skillApp = createApp({ dataRoot, port, skillsDirs: [skillRoot] });
    const res = await skillApp.fetch(
      new Request(`http://127.0.0.1:${port}/api/skills`, { headers: { host: `127.0.0.1:${port}` } }),
    );
    const body = await res.json();
    check(
      'skills-list',
      res.status === 200 && body.skills.some((s: { id: string }) => s.id === 'demo'),
      body.skills,
    );
  }

  {
    const created = await call('/api/schedules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '每日巡检工作区', intervalMs: 3600000 }),
    });
    const createdBody = await created.json();
    check('schedule-create', created.status === 201 && createdBody.schedule?.prompt === '每日巡检工作区', createdBody);
    const list = await call('/api/schedules');
    const listBody = await list.json();
    check('schedule-list', listBody.schedules?.length === 1, listBody.schedules);
    const thought = await call('/api/schedules/thoughts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '明天把侧栏做完' }),
    });
    const thoughtBody = await thought.json();
    check('thought-create', thought.status === 201 && thoughtBody.thought?.content.includes('侧栏'), thoughtBody);
  }

  {
    const legacyRoot = await mkdtemp(path.join(tmpdir(), 'reizo-desktop-legacy-'));
    const stub = Buffer.from('enc:sk-legacy').toString('base64');
    await writeFile(
      path.join(legacyRoot, 'settings.json'),
      JSON.stringify({ openaiApiKey: stub }, null, 2),
      'utf8',
    );
    const legacyApp = createApp({ dataRoot: legacyRoot, port });
    const res = await legacyApp.fetch(
      new Request(`http://127.0.0.1:${port}/api/settings`, { headers: { host: `127.0.0.1:${port}` } }),
    );
    const body = await res.json();
    const openai = body.providers.find((p: { id: string }) => p.id === 'openai');
    check('legacy-openai-key-migrates', openai?.hasKey === true, openai);
  }

  console.log(`\ndata root: ${dataRoot}`);
  if (failed) {
    console.error('\nSMOKE TEST FAILED');
    process.exit(1);
  }
  console.log('\nSMOKE TEST PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
