import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const runMock = vi.fn(async () => ({ cursor: { x: 5, y: 6 } }));
const screenshotMock = vi.fn(async () => ({
  png: Buffer.from('PNGDATA'),
  imageSize: { width: 1280, height: 800 },
  logicalSize: { width: 1280, height: 800 },
  scaleFactor: 1,
}));

vi.mock('../../computerUse', () => ({
  isComputerUseSupported: () => true,
  createComputerController: () => ({
    run: runMock,
    screenshot: screenshotMock,
    dispose: vi.fn(),
  }),
}));

import { createComputerTools } from './computerTools';
import {
  answerPermission,
  isApprovalRequiredError,
  resetPermissionsForTests,
  setPermissionSink,
} from './permissions';

function setup() {
  resetPermissionsForTests();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reizo-cu-'));
  const events: unknown[] = [];
  const toolset = createComputerTools({
    sessionId: 'sess-1',
    dataRoot,
    permissionMode: 'full',
    emit: (e) => events.push(e),
  });
  return { toolset, dataRoot };
}

afterEach(() => {
  resetPermissionsForTests();
  runMock.mockClear();
  screenshotMock.mockClear();
});

describe('computer tool', () => {
  it('suspends for approval on first use even in permissionMode "full"', async () => {
    const { toolset } = setup();
    const tool = toolset.tools.computer;
    await expect(
      (tool.execute as (i: unknown, o: unknown) => Promise<unknown>)(
        { action: 'screenshot' },
        { toolCallId: 'call-1', messages: [] },
      ),
    ).rejects.toSatisfy(isApprovalRequiredError);
    // No action ran while waiting for the user.
    expect(runMock).not.toHaveBeenCalled();
  });

  it('runs actions after allow-session and returns a screenshot url', async () => {
    const { toolset } = setup();
    setPermissionSink('sess-1', () => undefined);
    const tool = toolset.tools.computer;

    await (tool.execute as (i: unknown, o: unknown) => Promise<unknown>)(
      { action: 'left_click', x: 10, y: 20 },
      { toolCallId: 'call-2', messages: [] },
    ).catch((): undefined => undefined);
    answerPermission('call-2', 'allow-session');

    const out = await toolset.executeApproved({ action: 'left_click', x: 10, y: 20 });
    expect(out.error).toBeUndefined();
    const parsed = JSON.parse(out.result as string);
    expect(parsed).toMatchObject({
      ok: true,
      action: 'left_click',
      screenSize: { width: 1280, height: 800 },
    });
    expect(parsed.screenshotUrl).toMatch(/^\/api\/computer-use\/sess-1\/shot-.*\.png$/);
    expect(runMock).toHaveBeenCalled();
  });

  it('rejects an unknown action in executeApproved', async () => {
    const { toolset } = setup();
    const out = await toolset.executeApproved({ action: 'nope' });
    expect(out.error).toBeTruthy();
  });
});
