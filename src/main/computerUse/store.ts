import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Root under `<dataRoot>` where computer-use screenshots are kept. */
export const COMPUTER_USE_DIR = 'computer-use';

function shotDir(dataRoot: string, sessionId: string): string {
  const safeSession = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(dataRoot, COMPUTER_USE_DIR, safeSession);
}

function resolveInside(dataRoot: string, relPath: string): string {
  const base = path.resolve(dataRoot, COMPUTER_USE_DIR);
  const abs = path.resolve(base, relPath);
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    throw new Error('screenshot path escapes computer-use dir');
  }
  return abs;
}

/** Persist a PNG, return the `<session>/<file>` relative key. */
export async function saveScreenshot(
  dataRoot: string,
  sessionId: string,
  png: Buffer,
): Promise<string> {
  const dir = shotDir(dataRoot, sessionId);
  await mkdir(dir, { recursive: true });
  const file = `shot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.png`;
  await writeFile(path.join(dir, file), png);
  return `${path.basename(dir)}/${file}`;
}

export function readScreenshot(dataRoot: string, relPath: string): Promise<Buffer> {
  return readFile(resolveInside(dataRoot, relPath));
}

/** Sync read used when rebuilding model history; returns null if the file is gone. */
export function readScreenshotSync(dataRoot: string, relPath: string): Buffer | null {
  try {
    return readFileSync(resolveInside(dataRoot, relPath));
  } catch {
    return null;
  }
}

/**
 * A tool-result `output` that carries a caption plus a PNG the model can see.
 * Uses the AI SDK's tagged `file` content part so both the live `toModelOutput`
 * path and the history-rebuild path emit an identical shape.
 */
export function screenshotContentOutput(
  caption: string,
  png: Buffer,
): {
  type: 'content';
  value: Array<
    | { type: 'text'; text: string }
    | { type: 'file'; mediaType: string; data: { type: 'data'; data: string } }
  >;
} {
  return {
    type: 'content',
    value: [
      { type: 'text', text: caption },
      { type: 'file', mediaType: 'image/png', data: { type: 'data', data: png.toString('base64') } },
    ],
  };
}
