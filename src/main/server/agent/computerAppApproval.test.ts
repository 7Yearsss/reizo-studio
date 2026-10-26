import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppApprovalNeededError, appApprovalNeed } from '../../../shared/computerAppPolicy';

// A stand-in controller that behaves like the real one: it asks for a gated app until that app is approved.
let front = { process: 'chrome.exe' };
const approvedApps = new Set<string>();
const runMock = vi.fn(async () => {
  const need = appApprovalNeed(front);
  if (need && !approvedApps.has(need.key)) throw new AppApprovalNeededError(need);
  return { cursor: { x: 1, y: 2 } };
});

vi.mock('../../computerUse', () => ({
  isComputerUseSupported: () => true,
  createComputerController: () => ({
    run: runMock,
    screenshot: async () => ({ png: Buffer.from('PNG'), imageSize: { width: 100, height: 100 }, logicalSize: { width: 100, height: 100 }, scaleFactor: 1 }),
    approvedApps,
    dispose: vi.fn(),
  }),
}));

import { createComputerTools } from './computerTools';
import { answerPermission, consumeInteractions, resetPermissionsForTests, setPermissionSink } from './permissions';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reizo-appapproval-'));
afterEach(() => { resetPermissionsForTests(); approvedApps.clear(); runMock.mockClear(); front = { process: 'chrome.exe' }; });

type Exec = (i: unknown, o: unknown) => Promise<unknown>;

describe('computer use: browser / chat / mail apps ask once per session', () => {
  it('holds the first action on a browser, then lets that app through after approval, and still asks for another app', async () => {
    const toolset = createComputerTools({ sessionId: 's-app', dataRoot: tmp, permissionMode: 'full', emit: () => undefined });
    setPermissionSink('s-app', () => undefined);
    const computer = toolset.tools.computer.execute as Exec;

    // The session-wide "may the agent use the computer" card comes first, as before.
    await computer({ action: 'left_click', x: 1, y: 1 }, { toolCallId: 'g1', messages: [] }).catch((): undefined => undefined);
    answerPermission('g1', 'allow-session');
    consumeInteractions('s-app');

    // Browser in front: the click is held back behind an app card naming the browser.
    await expect(computer({ action: 'left_click', x: 1, y: 1 }, { toolCallId: 'a1', messages: [] })).rejects.toBeTruthy();
    answerPermission('a1', 'allow');
    const [card] = consumeInteractions('s-app');
    expect(card).toMatchObject({ name: 'computer_app', args: { app: 'chrome', kind: '浏览器' } });
    expect(runMock.mock.calls.length).toBe(1); // it asked; nothing was clicked

    const approved = await toolset.executeApproved(card.args);
    expect(approved.error).toBeUndefined();

    // Same app, later action: no new card.
    const again = await computer({ action: 'left_click', x: 2, y: 2 }, { toolCallId: 'a2', messages: [] });
    expect(again).toMatchObject({ ok: true });

    // A different gated app (mail) asks again.
    front = { process: 'OUTLOOK.EXE' };
    await expect(computer({ action: 'left_click', x: 3, y: 3 }, { toolCallId: 'a3', messages: [] })).rejects.toBeTruthy();
    answerPermission('a3', 'deny');
    expect(consumeInteractions('s-app')[0]).toMatchObject({ name: 'computer_app', args: { kind: '邮件客户端' } });
  });
});
