import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/** Pinned renderer compatibility fixes, included in the corresponding source. */
export function patchRendererRuntime(source) {
  const require = createRequire(path.join(source, 'package.json'));
  const dist = path.dirname(require.resolve('@remotion/renderer'));
  const info = JSON.parse(readFileSync(path.join(dist, '../package.json'), 'utf8'));
  if (info.version !== '4.0.509') throw new Error(`Review renderer patches before upgrading ${info.version}`);
  const openFile = path.join(dist, 'open-browser.js');
  let open = readFileSync(openFile, 'utf8');
  if (!open.includes('Reizo cold Windows browser startup')) {
    const marker = '        timeout: 25000,';
    if (open.split(marker).length !== 2) throw new Error('Unexpected renderer launch timeout');
    open = open.replace(marker, "        // Reizo cold Windows browser startup can exceed 25 seconds.\n        timeout: process.platform === 'win32' ? 90000 : 25000,");
    writeFileSync(openFile, open);
  }
  const runnerFile = path.join(dist, 'browser/BrowserRunner.js');
  let runner = readFileSync(runnerFile, 'utf8');
  if (!runner.includes('Reizo cleans up failed browser launches')) {
    const marker = '        logLevel,\n    });\n    const transport =';
    runner = runner.replace(/\r\n/g, '\n');
    if (runner.split(marker).length !== 2) throw new Error('Unexpected renderer browser startup');
    runner = runner.replace(marker, `        logLevel,
    }).catch(async (error) => {
        // Reizo cleans up failed browser launches before returning the error.
        if (proc.pid && proc.exitCode === null && proc.signalCode === null) {
            if (process.platform === 'win32') {
                await new Promise((resolve) => childProcess.execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {windowsHide: true}, () => {
                    try { proc.kill(); } catch {}
                    resolve();
                }));
            } else {
                try { process.kill(-proc.pid, 'SIGKILL'); } catch { try { proc.kill(); } catch {} }
            }
        }
        throw error;
    });
    const transport =`);
    writeFileSync(runnerFile, runner);
  }
}
