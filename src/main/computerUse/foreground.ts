import { execFile } from 'node:child_process';
import type { ForegroundApp } from '../../shared/computerAppPolicy';

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 3_000 }, (error, stdout) => (error ? reject(error) : resolve(String(stdout).trim())));
  });
}

/** Front app on macOS / Linux (Windows answers through its own input helper). Null when it cannot be determined. */
export async function posixForegroundApp(platform: NodeJS.Platform = process.platform): Promise<ForegroundApp | null> {
  try {
    if (platform === 'darwin') {
      const name = await run('osascript', ['-e', 'tell application "System Events" to get name of first process whose frontmost is true']);
      return name ? { process: name } : null;
    }
    if (platform === 'linux') {
      const pid = Number(await run('xdotool', ['getactivewindow', 'getwindowpid']));
      if (!Number.isFinite(pid) || pid <= 0) return null;
      return { pid, process: await run('ps', ['-p', String(pid), '-o', 'comm=']) };
    }
  } catch { /* detection is best-effort */ }
  return null;
}
