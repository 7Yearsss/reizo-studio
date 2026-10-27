import { browserRequestAllowed, browserUrlProblem } from '../shared/browserUrl';

export interface RenderedPage { finalUrl: string; title: string; text: string; links: Array<{ text: string; href: string }> }

const LOAD_TIMEOUT_MS = 30_000;
/** After the load event, give scripts a moment to draw the content before reading it. */
const SETTLE_MS = 1500;
const MAX_TEXT = 60_000;

const EXTRACT = `(() => {
  const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  const links = [...document.querySelectorAll('a[href]')].slice(0, 300).map((a) => ({ text: clean(a.innerText).slice(0, 80), href: a.href })).filter((l) => /^https?:/.test(l.href) && l.text).slice(0, 40);
  return { title: clean(document.title), text: document.body ? document.body.innerText : '', links };
})()`;

/**
 * Load a public page the way a browser does (scripts run, so single-page apps and dashboards render) and return its
 * text. The window is hidden, in-memory (no cookies or logins carry over, none are kept), sandboxed, and every request
 * it makes is held to the same public-web rule as the address itself. Popups, downloads and permission prompts are refused.
 */
export async function readRenderedPage(url: string, signal?: AbortSignal): Promise<RenderedPage> {
  const problem = browserUrlProblem(url);
  if (problem) throw new Error(problem);
  const { BrowserWindow, session } = await import('electron');
  const partition = `reizo-reader-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ses = session.fromPartition(partition);
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !browserRequestAllowed(details.url) }));
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.on('will-download', (event) => event.preventDefault());

  const win = new BrowserWindow({
    show: false, width: 1280, height: 900,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, session: ses, javascript: true, webSecurity: true, backgroundThrottling: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, target) => { if (!browserRequestAllowed(target)) event.preventDefault(); });
  win.webContents.on('will-redirect', (event, target) => { if (!browserRequestAllowed(target)) event.preventDefault(); });

  const abort = (): void => { if (!win.isDestroyed()) win.destroy(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    await Promise.race([
      win.loadURL(url),
      new Promise<never>((_, reject) => { setTimeout(() => reject(new Error('页面加载超时（30 秒）')), LOAD_TIMEOUT_MS); }),
    ]);
    await new Promise((resolve) => { setTimeout(resolve, SETTLE_MS); });
    if (win.isDestroyed()) throw new Error('已取消');
    const out = (await win.webContents.executeJavaScript(EXTRACT, true)) as { title: string; text: string; links: Array<{ text: string; href: string }> };
    return { finalUrl: win.webContents.getURL(), title: out.title, text: out.text.replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT), links: out.links };
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!win.isDestroyed()) win.destroy();
    void ses.clearStorageData().catch((): void => undefined);
  }
}
