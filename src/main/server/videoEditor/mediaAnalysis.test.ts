import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeMediaFile, parseSceneCuts, parseSilences, soundSegmentsFrom } from './mediaAnalysis';

describe('media analysis parsing', () => {
  it('pairs silence start/end lines and closes a trailing silence at the media end', () => {
    const log = [
      '[silencedetect @ 0x1] silence_start: 1.5',
      '[silencedetect @ 0x1] silence_end: 2.75 | silence_duration: 1.25',
      '[silencedetect @ 0x1] silence_start: 8.2',
    ].join('\n');
    expect(parseSilences(log, 10)).toEqual([
      { start: 1.5, end: 2.75, duration: 1.25 },
      { start: 8.2, end: 10, duration: 1.8 },
    ]);
  });
  it('clamps negative starts and ignores an end without a start', () => {
    expect(parseSilences('silence_end: 1.0\nsilence_start: -0.01\nsilence_end: 0.5', 5)).toEqual([{ start: 0, end: 0.5, duration: 0.5 }]);
  });
  it('derives sound segments as the complement and drops slivers', () => {
    const silences = [{ start: 0, end: 1, duration: 1 }, { start: 4, end: 4.05, duration: 0.05 }, { start: 9, end: 10, duration: 1 }];
    expect(soundSegmentsFrom(silences, 10)).toEqual([
      { start: 1, end: 4, duration: 3 },
      { start: 4.05, end: 9, duration: 4.95 },
    ]);
  });
  it('reads scene cuts from showinfo lines only and skips the first frame', () => {
    const log = [
      '[Parsed_showinfo_2 @ 0x1] n:   0 pts:      0 pts_time:0.01      duration: 1',
      '[Parsed_showinfo_2 @ 0x1] n:   1 pts:  90000 pts_time:3.5       duration: 1',
      '[Parsed_showinfo_2 @ 0x1] n:   2 pts: 180000 pts_time:3.5       duration: 1',
      '[other] pts_time:7.0',
      '[Parsed_showinfo_2 @ 0x1] n:   3 pts: 300000 pts_time:12.25     duration: 1',
    ].join('\n');
    expect(parseSceneCuts(log, 20)).toEqual([3.5, 12.25]);
  });
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status === 0;

describe.skipIf(!hasFfmpeg)('analyzeMediaFile with real ffmpeg', () => {
  it('finds the silent gap and the colour cut in a synthetic clip', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'reizo-analyze-'));
    try {
      const file = path.join(dir, 'clip.mp4');
      // 6s: red 0-3s then blue; tone 0-2s, silence 2-4s, tone 4-6s.
      const made = spawnSync('ffmpeg', ['-y', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'color=c=red:s=160x90:d=3:r=10', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=3:r=10',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
        '-filter_complex', '[0][1]concat=n=2:v=1:a=0[v];[2][3][4]concat=n=3:v=0:a=1[a]', '-map', '[v]', '-map', '[a]', '-pix_fmt', 'yuv420p', file], { windowsHide: true });
      expect(made.status, String(made.stderr)).toBe(0);
      const result = await analyzeMediaFile(file, { silence: true, scenes: true, silenceDb: -35, minSilenceSeconds: 0.6, sceneThreshold: 0.3 }, AbortSignal.timeout(30_000));
      expect(result.hasAudio && result.hasVideo).toBe(true);
      expect(result.silences).toHaveLength(1);
      expect(result.silences![0].start).toBeCloseTo(2, 0);
      expect(result.silences![0].end).toBeCloseTo(4, 0);
      expect(result.sceneCutsSeconds).toHaveLength(1);
      expect(result.sceneCutsSeconds![0]).toBeCloseTo(3, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
