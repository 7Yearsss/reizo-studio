import { describe, expect, it } from 'vitest';
import { snapCut, snapShot } from './cutSnapping';

const silence = (start: number, end: number) => ({ start, end, duration: end - start });

describe('snapCut', () => {
  it('leaves a cut that already sits inside a silence', () => {
    expect(snapCut(5.2, { silences: [silence(5, 6)] })).toEqual({ seconds: 5.2, shiftSeconds: 0, reason: 'already-in-silence' });
  });
  it('moves a cut just inside the nearest silence edge when within reach', () => {
    const result = snapCut(4.9, { silences: [silence(5, 6)] });
    expect(result.reason).toBe('snapped-to-silence');
    expect(result.seconds).toBeGreaterThan(5);
    expect(result.seconds).toBeLessThan(5.2);
  });
  it('snaps to the middle of a gap between words', () => {
    const words = [{ start: 0, end: 1 }, { start: 1.4, end: 2 }];
    expect(snapCut(1.15, { silences: [], words })).toEqual({ seconds: 1.2, shiftSeconds: 0.05, reason: 'snapped-to-word-gap' });
  });
  it('flags a cut inside a word when no boundary is close enough', () => {
    const words = [{ start: 0, end: 3 }];
    expect(snapCut(1.5, { silences: [silence(9, 10)], words }).reason).toBe('mid-word-no-boundary');
  });
  it('does not invent a boundary where there is no speech information nearby', () => {
    expect(snapCut(1.5, { silences: [silence(9, 10)] })).toEqual({ seconds: 1.5, shiftSeconds: 0, reason: 'no-safe-boundary-nearby' });
  });
});

describe('snapShot', () => {
  it('snaps both edges, aligns to the frame grid and reports the duration change', () => {
    const boundaries = { silences: [silence(1.9, 2.3), silence(6.8, 7.4)] };
    const shot = snapShot({ sourceStartSeconds: 2.35, durationSeconds: 4.5 }, boundaries, 30, 20);
    expect(shot.start.reason).toBe('snapped-to-silence');
    expect(shot.end.reason).toBe('already-in-silence');
    expect(Math.abs(shot.sourceStartSeconds * 30 - Math.round(shot.sourceStartSeconds * 30))).toBeLessThan(0.02);
    expect(shot.sourceStartSeconds).toBeLessThan(2.3);
    expect(shot.durationDeltaSeconds).toBeCloseTo(shot.durationSeconds - 4.5, 3);
  });
  it('clamps to the media bounds and never inverts a tiny window', () => {
    const shot = snapShot({ sourceStartSeconds: 0.01, durationSeconds: 0.05 }, { silences: [silence(0, 0.2)] }, 30, 10);
    expect(shot.durationSeconds).toBeGreaterThan(0);
    expect(shot.sourceStartSeconds).toBeGreaterThanOrEqual(0);
  });
});

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeMediaFile } from './mediaAnalysis';

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status === 0;

describe.skipIf(!hasFfmpeg)('snapShot with real silence detection', () => {
  it('moves a cut that clips the tone into the detected pause', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'reizo-snap-'));
    try {
      const file = path.join(dir, 'clip.wav');
      // tone 0-2s, silence 2-4s, tone 4-6s
      const made = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
        '-filter_complex', '[0][1][2]concat=n=3:v=0:a=1[a]', '-map', '[a]', file], { windowsHide: true });
      expect(made.status, String(made.stderr)).toBe(0);
      const analysis = await analyzeMediaFile(file, { silence: true, scenes: false, silenceDb: -35, minSilenceSeconds: 0.25, sceneThreshold: 0.3 }, AbortSignal.timeout(30_000));
      // Requested window 4.1-5.1 starts 0.1s into the second tone: clips it.
      const shot = snapShot({ sourceStartSeconds: 4.1, durationSeconds: 1 }, { silences: analysis.silences ?? [] }, 30, analysis.durationSeconds);
      expect(shot.start.reason).toBe('snapped-to-silence');
      expect(shot.sourceStartSeconds).toBeLessThan(4.05);
      expect(shot.sourceStartSeconds).toBeGreaterThan(3.7);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
