import { browserRequestAllowed, browserUrlProblem } from '../shared/browserUrl';
import { BROWSER_PARTITION, hardenBrowserSession as harden } from './browserSession';

export interface RenderedPage { finalUrl: string; title: string; text: string; links: Array<{ text: string; href: string }> }
export interface ReadOptions {
  /** Use the browser profile the user logged in with in the visible window, instead of a clean throwaway one. */
  signedIn?: boolean;
}

const LOAD_TIMEOUT_MS = 30_000;
/** After the load event, give scripts a moment to draw the content before reading it. */
const SETTLE_MS = 1500;
const MAX_TEXT = 60_000;
/** The one profile that keeps logins between runs; only the visible window and `signedIn` reads use it. */
const PERSISTENT_PARTITION = BROWSER_PARTITION;

const EXTRACT = `(() => {
  const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  const links = [...document.querySelectorAll('a[href]')].slice(0, 300).map((a) => ({ text: clean(a.innerText).slice(0, 80), href: a.href })).filter((l) => /^https?:/.test(l.href) && l.text).slice(0, 40);
  return { title: clean(document.title), text: document.body ? document.body.innerText : '', links };
})()`;

/** Public web only for every request, no permission prompts, no downloads. */

/**
 * Load a public page the way a browser does (scripts run, so single-page apps and dashboards render) and return its
 * text. The window is hidden and sandboxed, and every request it makes is held to the same public-web rule as the
 * address itself. By default the profile is in memory and thrown away (no logins); `signedIn` uses the profile the
 * user logged in with. Popups, downloads and permission prompts are refused.
 */
export async function readRenderedPage(url: string, signal?: AbortSignal, options: ReadOptions = {}): Promise<RenderedPage> {
  const problem = browserUrlProblem(url);
  if (problem) throw new Error(problem);
  const { BrowserWindow, session } = await import('electron');
  const throwaway = !options.signedIn;
  const ses = session.fromPartition(throwaway ? `reizo-reader-${Date.now()}-${Math.random().toString(36).slice(2)}` : PERSISTENT_PARTITION);
  harden(ses);

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
    if (throwaway) void ses.clearStorageData().catch((): void => undefined);
  }
}

let visible: import('electron').BrowserWindow | null = null;

/**
 * A normal, visible browser window on the persistent profile, so the user can log in (or solve a check) themselves.
 * The assistant never sees what is typed; afterwards `signedIn` reads can use the saved login.
 */
export async function openVisibleBrowser(url: string): Promise<void> {
  const problem = browserUrlProblem(url);
  if (problem) throw new Error(problem);
  const { BrowserWindow, session } = await import('electron');
  harden(session.fromPartition(PERSISTENT_PARTITION));
  if (visible && !visible.isDestroyed()) {
    void visible.loadURL(url).catch((): void => undefined);
    visible.show();
    visible.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 1100, height: 800, title: 'Reizo 浏览器 — 登录后关闭此窗口即可',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: PERSISTENT_PARTITION, webSecurity: true },
  });
  visible = win;
  // Login flows love popups: open them in this same window instead, as long as the address is allowed.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (browserRequestAllowed(target)) void win.loadURL(target).catch((): void => undefined);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => { if (!browserRequestAllowed(target)) event.preventDefault(); });
  win.webContents.on('will-redirect', (event, target) => { if (!browserRequestAllowed(target)) event.preventDefault(); });
  win.on('closed', () => { if (visible === win) visible = null; });
  void win.loadURL(url).catch((): void => undefined);
}

/** Forget every login the browser profile holds. */
export async function clearBrowserLogins(): Promise<void> {
  const { session } = await import('electron');
  await session.fromPartition(PERSISTENT_PARTITION).clearStorageData();
}
