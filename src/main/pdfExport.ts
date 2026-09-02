import { BrowserWindow } from 'electron';

/**
 * Render an HTML document to PDF bytes in a throwaway hidden BrowserWindow.
 * Ported from cindy's `htmlPdfRenderer.ts`:
 *  - use-once-and-destroy (never pool — reuse leaks timers / service workers /
 *    prior document across tasks, which is a security regression, not a perf
 *    win)
 *  - every webPreferences security field set explicitly, no preload
 *  - all navigation / window-open denied
 *  - 30s hard timeout, concurrency 1 (printToPDF is full Chromium layout+raster)
 *  - never auto-retries
 */
const HARD_TIMEOUT_MS = 30_000;

const ignore = (): undefined => undefined;
let chain: Promise<unknown> = Promise.resolve();

export function exportHtmlToPdf(html: string): Promise<Buffer> {
  const run = async (): Promise<Buffer> => {
    const win = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
        navigateOnDragDrop: false,
        webviewTag: false,
        spellcheck: false,
      },
    });

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    let loaded = false;
    win.webContents.on('will-navigate', (e) => {
      if (loaded) e.preventDefault();
    });

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('PDF export timed out')), HARD_TIMEOUT_MS),
    );

    try {
      await Promise.race([
        win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`),
        timeout,
      ]);
      loaded = true;
      const pdf = await Promise.race([
        win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' }),
        timeout,
      ]);
      return pdf;
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  };

  // Concurrency 1: chain onto the previous export, success or failure.
  const result = chain.then(run, run);
  chain = result.then(ignore, ignore);
  return result;
}
