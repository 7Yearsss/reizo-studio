import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Harness² D1: Configuration fingerprint + completion marker (`runmark.json`).
 * Ensures long-running canvas nodes or background artifacts are only reused when both:
 * 1. Their configuration fingerprint (`sha256` of canonicalized config) matches, and
 * 2. Their expected output deliverables actually exist and are non-empty.
 */

export interface RunmarkRecord {
  fingerprint: string;
  completedAt: string;
  outputs: string[];
}

export function computeConfigFingerprint(config: Record<string, unknown>): string {
  const canonical = canonicalizeJson(config);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalizeJson(v)}`).join(',')}}`;
}

export async function writeRunmark(
  dir: string,
  config: Record<string, unknown>,
  outputs: string[],
): Promise<RunmarkRecord> {
  await mkdir(dir, { recursive: true });
  const record: RunmarkRecord = {
    fingerprint: computeConfigFingerprint(config),
    completedAt: new Date().toISOString(),
    outputs,
  };
  await writeFile(path.join(dir, 'runmark.json'), JSON.stringify(record, null, 2), 'utf8');
  return record;
}

export async function checkRunmark(
  dir: string,
  config: Record<string, unknown>,
  verifyOutput?: (outputRelPath: string) => Promise<boolean>,
): Promise<{ valid: boolean; reason?: string; record?: RunmarkRecord }> {
  try {
    const raw = await readFile(path.join(dir, 'runmark.json'), 'utf8');
    const record = JSON.parse(raw) as RunmarkRecord;
    const expected = computeConfigFingerprint(config);
    if (record.fingerprint !== expected) {
      return { valid: false, reason: `fingerprint mismatch (${record.fingerprint} !== ${expected})`, record };
    }
    if (verifyOutput) {
      for (const out of record.outputs) {
        if (!(await verifyOutput(out))) {
          return { valid: false, reason: `missing or invalid output: ${out}`, record };
        }
      }
    }
    return { valid: true, record };
  } catch {
    return { valid: false, reason: 'runmark.json not found or unreadable' };
  }
}
