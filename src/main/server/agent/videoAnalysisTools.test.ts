import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VideoEvidence } from '../../../shared/videoAnalysis';
import type { ModelMessage } from 'ai';
import { createVideoAnalysisTools } from './videoAnalysisTools';
import { answerPermission, resetPermissionsForTests } from './permissions';
import { parseVideoAnalysis, videoAnalysisModelOutput } from './videoAnalysisStore';

const roots: string[] = [];
afterEach(async () => { resetPermissionsForTests(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(mode: 'full' | 'ask' = 'full', vision?: boolean) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'reizo-video-analysis-')); roots.push(dataRoot);
  const evidence: VideoEvidence = { url: 'https://example.com/clip', title: 'Clip', duration: 152, start: 0, end: 152,
    frames: [{ timestamp: 0, jpeg: Buffer.from('first frame') }, { timestamp: 151.85, jpeg: Buffer.from('last frame') }], captions: [], audio: 'not-transcribed' };
  const readVideo = vi.fn(async () => evidence);
  return { dataRoot, readVideo, ...createVideoAnalysisTools({ sessionId: 's', dataRoot, permissionMode: mode, vision, readVideo }) };
}
const context = { toolCallId: 'v1', messages: [] as ModelMessage[], context: {} };

describe('video analysis tool', () => {
  it('requires approval before reading frames, and approved evidence survives the resume boundary', async () => {
    const f = await fixture('ask');
    await expect(f.tools.analyze_video.execute({ url: 'https://example.com/clip' }, context)).rejects.toThrow('__REIZO_INTERACTION_REQUIRED__');
    expect(f.readVideo).not.toHaveBeenCalled(); answerPermission('v1', 'allow');
    const approved = await f.executeApproved({ url: 'https://example.com/clip' });
    const output = videoAnalysisModelOutput(f.dataRoot, approved.result, 's');
    expect(output?.value.filter(part => part.type === 'file')).toHaveLength(2);
    expect(JSON.stringify(output)).toContain('151.85 seconds'); expect(JSON.stringify(output)).toContain('NOT been listened');
    expect(approved.result).not.toContain(Buffer.from('first frame').toString('base64'));
  });
  it('blocks private URLs and nonvisual models without opening a browser or asking for permission', async () => {
    const f = await fixture('ask');
    expect(await f.tools.analyze_video.execute({ url: 'http://127.0.0.1:47100/api/settings' }, context)).toMatchObject({ ok: false });
    expect(f.readVideo).not.toHaveBeenCalled();
    const textOnly = await fixture('full', false);
    expect(await textOnly.tools.analyze_video.execute({ url: 'https://example.com' }, context)).toMatchObject({ ok: false });
    expect(textOnly.readVideo).not.toHaveBeenCalled();
  });
  it('preserves real image content on live output and rejects forged paths or another session on replay', async () => {
    const f = await fixture(); const result = await f.tools.analyze_video.execute({ url: 'https://example.com/clip' }, context);
    const output = await f.tools.analyze_video.toModelOutput({ output: parseVideoAnalysis(result), toolCallId: 'v1', input: { url: 'https://example.com/clip' } });
    expect(output.type).toBe('content'); expect(videoAnalysisModelOutput(f.dataRoot, result, 'other')).toBeNull();
    expect(parseVideoAnalysis({ ...result, id: '../../secret' })).toBeNull();
    expect(parseVideoAnalysis({ ...result, frames: [{ timestamp: 0, file: '../../secret' }] })).toBeNull();
  });
});
